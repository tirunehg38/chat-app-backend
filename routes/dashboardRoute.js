const express = require('express');
const router = express.Router();
const { getHomeDashboard } = require('../controller/dashboardController');

router.get('/home', getHomeDashboard);

module.exports = router;
