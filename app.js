
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');
const redis = require('redis');

const app = express();
app.use(bodyParser.json());

const myCache = new NodeCache();

// const redisClient = redis.createClient({
//   url: 'redis://localhost:6379'
// });
// redisClient.on('error', (err) => console.log('Redis Client Error', err));
// redisClient.connect();


let refreshToken = ''; 

async function refreshCache() {
  myCache.del("readData");
 // await redisClient.del("readData");
}


async function getAccessToken() {
  try {
    const response = await axios.post(process.env.TOKEN_URL, {
      response_type: 'grant_token',
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      code: '60OLC-fbb4d69f5ce79a6cc55-beqyGc92KdMzoxO6UlTA'
    },{
        headers: { Authorization: process.env.AUTH_HEADER }
      });

    refreshToken = response.data.refresh_token;
    console.log("Tokeennnn",response.data.access_token);
    return response.data.access_token;
  } catch (error) {
    console.error('Error fetching access token:', error);
    throw new Error('Failed to get access token');
  }
}

async function refreshAccessToken() {
  try {
    const response = await axios.post(process.env.TOKEN_URL, {
      response_type: 'refresh_token',
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      refresh_token: refreshToken
    },{
        headers: { Authorization: process.env.AUTH_HEADER }
      });
    
    refreshToken = response.data.refresh_token;
    return response.data.access_token;
  } catch (error) {
    console.error('Error refreshing access token:', error);
    throw new Error('Failed to refresh access token');
  }
}

// Set data in Redis
async function setCache(key, value, ttl) {
  await redisClient.set(key, JSON.stringify(value), {
    EX: ttl
  });
}

// Get data from Redis
async function getCache(key) {
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
}

app.post('/api/send-data', async (req, res) => {
    let accessToken;
    try {
      accessToken = await getAccessToken();
    } catch (error) {
      return res.status(500).send('Error obtaining access token');
    }
  
    try {
      console.log("Inside token",accessToken);
      req.body.access_token = accessToken;
  
      
      const response = await axios.post('https://beta.mountstride.com/webapi/v2/content/create', req.body, {
        headers: { Authorization: process.env.AUTH_HEADER }
      });
  
      res.send(response.data);
    } catch (error) {
      if (error.response && error.response.status === 401) { 
        try {
          accessToken = await refreshAccessToken();
          req.body.access_token = accessToken;
        
          const retryResponse = await axios.post('https://beta.mountstride.com/webapi/v2/content/create', req.body, {
            headers: { Authorization: process.env.AUTH_HEADER }
          });
  
          res.send(retryResponse.data);
        } catch (refreshError) {
          res.status(500).send('Error refreshing access token: ' + refreshError.message);
        }
      } else {
        res.status(500).send('Error sending data to external API: ' + error.message);
      }
    }
    refreshCache();
  });
  
  app.post('/api/read-data', async (req, res) => {
    const cachedData = myCache.get("readData");
   //const cachedData = await getCache("readData");
   if (cachedData) {
        return res.send(cachedData);
    }
    let accessToken;
    try {
        accessToken = await getAccessToken();
    } catch (error) {
        return res.status(500).send('Error obtaining access token');
    }

    const requestData = {
        action: "NA131.READ",
        access_token: accessToken,
        filter: {
            "search_by": "ALL"
        }
    };

    try {
        const response = await axios.post('https://beta.mountstride.com/webapi/v2/content/read', requestData, {
            headers: { Authorization: process.env.AUTH_HEADER }
        });

        myCache.set("readData", response.data, 100000); // Cache the response data for 10000 seconds
        //await setCache("readData", response.data, 10000);
        res.send(response.data);
    } catch (error) {
        if (error.response && error.response.status === 401) {
            try {
                accessToken = await refreshAccessToken();
                requestData.access_token = accessToken;
                const retryResponse = await axios.post('https://beta.mountstride.com/webapi/v2/content/read', requestData, {
                    headers: { Authorization: process.env.AUTH_HEADER }
                });
                res.send(retryResponse.data);
            } catch (refreshError) {
                res.status(500).send('Error refreshing access token: ' + refreshError.message);
            }
        } else {
            res.status(500).send('Error reading data: ' + error.message);
        }
    }
});


app.post('/api/calculate-markup', async (req, res) => {
  const { bookingDate, checkInDate, serviceType, location, rulecontactid, agentid, supplierid1, price, pax, night, unit } = req.body;

  let finalPrice = price;
  let accessToken;

  try {
    accessToken = await getAccessToken();
  } catch (error) {
    return res.status(500).send('Error obtaining access token');
  }

  try {
    const rulesData = myCache.get('readData');
    if (!rulesData || !rulesData.data) {
      throw new Error('No rules data found in cache');
    }

    const { bestAgentRule, bestSupplierRule } = findMatchingRules(bookingDate, checkInDate, serviceType, location, rulecontactid, agentid, supplierid1, rulesData.data);

    if (bestSupplierRule) {
      finalPrice = applyMarkup(finalPrice, bestSupplierRule.markupvalue, bestSupplierRule.markuptype, bestSupplierRule.percentagetype, bestSupplierRule.calculationmethodcode, pax, night, unit);
    }

    if (!bestAgentRule || bestAgentRule.ignorecompanymarkup !== 'Yes') {
      const companyMarkup = findCompanyMarkup(rulesData.data);
      if (companyMarkup) {
        finalPrice = applyMarkup(finalPrice, companyMarkup.markupvalue, companyMarkup.markuptype, companyMarkup.percentagetype, companyMarkup.calculationMethodCode, pax, night, unit);
      }
    }

    if (bestAgentRule) {
      finalPrice = applyMarkup(finalPrice, bestAgentRule.markupvalue, bestAgentRule.markuptype, bestAgentRule.percentagetype, bestAgentRule.calculationmethodcode, pax, night, unit);
    }

    res.json({ originalPrice: price, finalPrice });
  } catch (error) {
    console.error('Error in /api/calculate-markup:', error);
    res.status(500).send('Internal Server Error');
  }
});

function findCompanyMarkup(rules) {
  for (const key in rules) {
    if (rules.hasOwnProperty(key)) {
      const rule = rules[key].meta;
      if (rule.agentid === "1") {
        return rule;
      }
    }
  }
  return null;
}


function applyMarkup(price, markupValue, markuptype, percentagetype, calculationMethodCode, pax, night, unit) {
  const markupFloat = parseFloat(markupValue);

  if (markuptype === 'p') {
    return applyPercentageMarkup(price, markupFloat, percentagetype);
  } else if (markuptype === 'f') {
    return applyFixedMarkup(price, markupFloat, calculationMethodCode, pax, night, unit);
  }
  return price;  // Unknown markup type, return the original price
}

function applyPercentageMarkup(price, markupValue, percentagetype) {
  if (percentagetype === 'MG') {
    // Margin
    return parseFloat((price * 100 / (100 - markupValue)).toFixed(2));
  } else {
    // Markup
    return parseFloat((price * (1 + markupValue / 100)).toFixed(2));
  }
}

function applyFixedMarkup(price, markupValue, calculationMethodCode, pax, night, unit) {
  let additionalCost = 0;
  switch (calculationMethodCode) {
    case 'PPPN': // Per Person Per Night
      additionalCost = markupValue * pax * night;
      break;
    case 'PPPB': // Per Person Per Booking
      additionalCost = markupValue * pax;
      break;
    case 'PUPN': // Per Unit Per Night
      additionalCost = markupValue * night * unit;
      break;
    case 'PUPB': // Per Unit Per Booking
      additionalCost = markupValue * unit;
      break;
  }
  return price + additionalCost;
}

function findMatchingRules(bookingDate, checkInDate, serviceType, location, rulecontactid1, agentId, supplierID, rules) {
  let bestAgentRule = null;
  let bestSupplierRule = null;
  let highestAgentPriority = Number.MAX_SAFE_INTEGER;
  let highestSupplierPriority = Number.MAX_SAFE_INTEGER;

  const parsedBookingDate = new Date(bookingDate).getTime();
  const parsedCheckInDate = new Date(checkInDate).getTime();

  Object.values(rules).forEach(ruleData => {
    const rule = ruleData.meta;
    const contentId = parseInt(ruleData.content_id);

    if (!isDateInRange(parsedBookingDate, rule.bookingdaterange) || !isDateInRange(parsedCheckInDate, rule.checkindaterange)) {
      return; // Skip if date not in range
    }

    if (rule.servicetype !== serviceType || rule.locationname !== location) {
      return; // Skip if service type or location doesn't match
    }

    if (rule.rulecontacttype === 'AG' && rule.rulecontactid === rulecontactid1) {
      if (!supplierID || rule.supplierid1.split(',').includes(supplierID)) {
        if (parseInt(rule.priority) < highestAgentPriority || (parseInt(rule.priority) === highestAgentPriority && contentId > highestAgentContentId)) {
          highestAgentPriority = parseInt(rule.priority);
          bestAgentRule = rule;
        }
      }
    }

    if (rule.rulecontacttype === 'SP' && rule.rulecontactid === rulecontactid1) {
      if (!agentId || rule.agentid.split(',').includes(agentId)) {
        if (parseInt(rule.priority) < highestSupplierPriority || (parseInt(rule.priority) === highestSupplierPriority && contentId > highestSupplierContentId)) {
          highestSupplierPriority = parseInt(rule.priority);
          bestSupplierRule = rule;
        }
      }
    }
  });

  return { bestAgentRule, bestSupplierRule };
}

function isDateInRange(dateTimestamp, range) {
  const [startDate, endDate] = range.split(' - ').map(d => new Date(d).getTime());
  return dateTimestamp >= startDate && dateTimestamp <= endDate;
}


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});