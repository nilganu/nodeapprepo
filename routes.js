// routes.js
const express = require('express');
const router = express.Router();
const apiController = require('./controllers/apiController');

router.post('/send-data', apiController.sendData);
router.post('/read-data', apiController.readData);
router.post('/calculate-markup', apiController.calculateMarkup);

module.exports = router;
