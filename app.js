
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');

const app = express();
app.use(bodyParser.json());

const myCache = new NodeCache();
let refreshToken = ''; 

function refreshCache() {
  myCache.del("readData");
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
  const { bookingDate, checkInDate, serviceType, location, rulecontacttype, rulecontactid,agentid,supplierid1, price, pax, night, unit } = req.body;

  //let agentId = rulecontacttype === 'AG' ? rulecontactid : '';
  //let supplierId = rulecontacttype === 'SP' ? rulecontactid : '';

  try {
    const rulesData = myCache.get('readData');
    if (!rulesData || !rulesData.data) {
      throw new Error('No rules data found in cache');
    }

    const { bestAgentRule, bestSupplierRule } = findMatchingRules(bookingDate, checkInDate, serviceType, location,rulecontactid, agentid, supplierid1,rulesData.data);
    let finalPrice = price;

    if (bestSupplierRule) {
      finalPrice = applyMarkup(finalPrice, parseFloat(bestSupplierRule.markupvalue), bestSupplierRule.markuptype, bestSupplierRule.percentagetype, bestSupplierRule.calculationmethodcode, pax, night, unit);
    }

    if (!bestAgentRule || bestAgentRule.ignorecompanymarkup !== 'Yes') {
      const companyMarkup = findCompanyMarkup(rulesData.data);
      if (companyMarkup) {
        finalPrice = applyMarkup(finalPrice, parseFloat(companyMarkup.markupvalue), companyMarkup.markuptype, companyMarkup.percentagetype, companyMarkup.calculationMethodCode, pax, night, unit);
      }
    }

    if (bestAgentRule) {
      finalPrice = applyMarkup(finalPrice, parseFloat(bestAgentRule.markupvalue), bestAgentRule.markuptype, bestAgentRule.percentagetype, bestAgentRule.calculationmethodcode, pax, night, unit);
    }

    res.json({ originalPrice: price, finalPrice });
  } catch (error) {
    console.error('Error:', error);
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
  markupValue = parseFloat(markupValue);

  if (markuptype === 'p') {
    // Percentage markup or margin
    if (percentagetype === 'MG') {
      // Margin
      console.log("Margin",parseFloat((price * 100 / (100 - markupValue)).toFixed(2)));
      return parseFloat((price * 100 / (100 - markupValue)).toFixed(2));
    } else {
      // Markup
      console.log("Markup",parseFloat((price * (1 + markupValue / 100)).toFixed(2)));
      return parseFloat((price * (1 + markupValue / 100)).toFixed(2));
    }
  } else if (markuptype === 'f') {
    // Fixed markup
    
    let additionalCost = 0;
    switch (calculationMethodCode) {
      case 'PPPN': // Per Person Per Night
       
        additionalCost = markupValue * pax * night;
        console.log("ffff",additionalCost);
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
  } else {
    // Unknown markup type, return the original price
    return price;
  }
}

function findMatchingRules(bookingDate, checkInDate, serviceType, location, rulecontactid1,agentId,supplierID, rules) {
  let bestAgentRule = null;
  let bestSupplierRule = null;
  let highestAgentPriority = Number.MAX_SAFE_INTEGER;
  let highestSupplierPriority = Number.MAX_SAFE_INTEGER;
  let highestAgentContentId = -1;
  let highestSupplierContentId = -1;

  for (const key in rules) {
    if (rules.hasOwnProperty(key)) {
      const rule = rules[key].meta;
      const contentId = parseInt(rules[key].content_id);
      const rulePriority = parseInt(rule.priority);

      // Check if bookingdaterange and checkindaterange are defined
      if (!rule.bookingdaterange || !rule.checkindaterange) {
        continue; // Skip this rule if either range is not defined
      }

      const ruleServiceType = rule.servicetype;
      const ruleLocation = rule.locationname;
      const ruleContactType = rule.rulecontacttype;
      const ruleContactId = rule.rulecontactid;
      const agentIdList = rule.agentid ? rule.agentid.split(',') : [];
      const supplierIdList = rule.supplierid1 ? rule.supplierid1.split(',') : [];
      const bookingDateRange = rule.bookingdaterange.split(' - ');
      const checkInDateRange = rule.checkindaterange.split(' - ');
      console.log(ruleContactType,"-",ruleContactId);

      if (isDateInRange(bookingDate, bookingDateRange) &&
          isDateInRange(checkInDate, checkInDateRange) &&
          ruleServiceType === serviceType &&
          ruleLocation === location) {
        
        // Check for agent rules
        console.log(supplierID);
        console.log(ruleContactType === 'AG',ruleContactId === rulecontactid1,rulePriority <= highestAgentPriority);
        if (ruleContactType === 'AG' && (ruleContactId === rulecontactid1) && rulePriority <= highestAgentPriority) {
          if ((supplierIdList.length === 0 || supplierIdList.includes(supplierID)) && (rulePriority < highestAgentPriority || contentId > highestAgentContentId)) {
            highestAgentPriority = rulePriority;
            highestAgentContentId = contentId;
            bestAgentRule = rule;
          }
        }

        // Check for supplier rules
        if (ruleContactType === 'SP' && (ruleContactId === rulecontactid1) && rulePriority <= highestSupplierPriority) {
          if ((agentIdList.length === 0 || agentIdList.includes(agentId)) && (rulePriority < highestSupplierPriority || contentId > highestSupplierContentId)) {
            highestSupplierPriority = rulePriority;
            highestSupplierContentId = contentId;
            bestSupplierRule = rule;
          }
        }
      }
    }
  }

  console.log("Agent Rule", bestAgentRule);
  console.log("Supplier Rule", bestSupplierRule);
  return { bestAgentRule, bestSupplierRule };
}

function isDateInRange(date, range) {
  const dateTimestamp = new Date(date).getTime();
  const startTimestamp = new Date(range[0]).getTime();
  const endTimestamp = new Date(range[1]).getTime();

  return dateTimestamp >= startTimestamp && dateTimestamp <= endTimestamp;
}



function isDateInRange(date, range) {
  const dateTimestamp = new Date(date).getTime();
  const startTimestamp = new Date(range[0]).getTime();
  const endTimestamp = new Date(range[1]).getTime();

  return dateTimestamp >= startTimestamp && dateTimestamp <= endTimestamp;
}
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});