const express = require('express');
const router = express.Router();
const { createAnswer, getAnswersForQuestion } = require('../controller/answerController');

router.post('/', createAnswer);
router.get('/:questionId', getAnswersForQuestion);

module.exports = router;