// controllers/apiController.js
const axios = require('axios');
const NodeCache = require('node-cache');
const {
  getAccessToken,
  refreshAccessToken,
  findMatchingRules,
  applyMarkup,
  findCompanyMarkup,
} = require('../helpers');

const myCache = new NodeCache();
let refreshToken = '';

const sendData = async (req, res) => {
  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (error) {
    return res.status(500).send('Error obtaining access token');
  }

  try {
    console.log("Inside token", accessToken);
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
};

const readData = async (req, res) => {
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
};

const calculateMarkup = async (req, res) => {
  const { bookingDate, checkInDate, serviceType, location, agentId, supplierId, price, pax, night, unit } = req.body;

  try {
    const rulesData = myCache.get('readData');
    if (!rulesData || !rulesData.data) {
      throw new Error('No rules data found in cache');
    }

    // Find the best matching rules
    const { bestAgentRule, bestSupplierRule } = findMatchingRules(bookingDate, checkInDate, serviceType, location, agentId, supplierId, rulesData.data);
    let finalPrice = price;

    // Apply markup for the best matching supplier rule
    if (bestSupplierRule) {
      finalPrice = applyMarkup(finalPrice, parseFloat(bestSupplierRule.markupvalue), bestSupplierRule.markuptype, bestSupplierRule.percentagetype, bestSupplierRule.calculationmethodcode, pax, night, unit);
    }
    console.log(bestAgentRule.calculationmethodcode);
    // Apply markup for the best matching agent rule
    if (bestAgentRule) {
      finalPrice = applyMarkup(finalPrice, parseFloat(bestAgentRule.markupvalue), bestAgentRule.markuptype, bestAgentRule.percentagetype, bestAgentRule.calculationmethodcode, pax, night, unit);
    }

    // Check for company markup and apply it if necessary
    const companyMarkup = findCompanyMarkup(rulesData.data);
    if (companyMarkup) {
      finalPrice = applyMarkup(finalPrice, parseFloat(companyMarkup.markupvalue), companyMarkup.markuptype, companyMarkup.percentagetype, companyMarkup.calculationMethodCode, pax, night, unit);
    }

    res.json({ originalPrice: price, finalPrice });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Internal Server Error');
  }
};

module.exports = {
  sendData,
  readData,
  calculateMarkup,
};
