const express = require('express');
const router = express.Router();
const { createQuestion, getAllQuestions, getQuestionById } = require('../controller/questionController');

router.post('/', createQuestion);
router.get('/', getAllQuestions);
router.get('/:id', getQuestionById);

module.exports = router;