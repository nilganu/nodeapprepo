// helpers.js
const axios = require('axios');

// Function to obtain an access token
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

function findMatchingRules(bookingDate, checkInDate, serviceType, location, agentId, supplierId, rules) {
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
      const bookingDateRange = rule.bookingdaterange.split(' - ');
      const checkInDateRange = rule.checkindaterange.split(' - ');

      if (isDateInRange(bookingDate, bookingDateRange) &&
          isDateInRange(checkInDate, checkInDateRange) &&
          ruleServiceType === serviceType &&
          ruleLocation === location) {
        
        // Check for agent rules
        if (rule.agentid === agentId && rulePriority <= highestAgentPriority) {
          if (rulePriority < highestAgentPriority || contentId > highestAgentContentId) {
            highestAgentPriority = rulePriority;
            highestAgentContentId = contentId;
            bestAgentRule = rule;
          }
        }

        // Check for supplier rules
        if (rule.supplierid === supplierId && rulePriority <= highestSupplierPriority) {
          if (rulePriority < highestSupplierPriority || contentId > highestSupplierContentId) {
            highestSupplierPriority = rulePriority;
            highestSupplierContentId = contentId;
            bestSupplierRule = rule;
          }
        }
      }
    }
  }
  console.log("Agent Rule",bestAgentRule);
  console.log("Supplier Rule",bestSupplierRule);
  return { bestAgentRule, bestSupplierRule };
}


function isDateInRange(date, range) {
  const dateTimestamp = new Date(date).getTime();
  const startTimestamp = new Date(range[0]).getTime();
  const endTimestamp = new Date(range[1]).getTime();

  return dateTimestamp >= startTimestamp && dateTimestamp <= endTimestamp;
}

module.exports = {
  getAccessToken,
  refreshAccessToken,
  findMatchingRules,
  applyMarkup,
  findCompanyMarkup,
};
