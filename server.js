// server.js
const express = require('express');
const bodyParser = require('body-parser');
const routes = require('./routes');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

app.use('/api', routes);

app.listen(3000, () => {
  console.log(`Server is running on port ${PORT}`);
});
