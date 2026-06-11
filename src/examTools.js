export function createEmptyQuestion(index = 0) {
  return {
    id: `q-${Date.now()}-${index}`,
    text: '',
    options: ['', '', '', ''],
    correctIndex: 0,
  };
}

export function normalizeQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).map((question, index) => ({
    id: question.id || `q-${index}`,
    text: question.text || '',
    options: Array.isArray(question.options) ? [...question.options, '', '', '', ''].slice(0, 4) : ['', '', '', ''],
    correctIndex: Number.isInteger(question.correctIndex) ? question.correctIndex : 0,
  }));
}

export function gradeAnswers(exam, answers) {
  const normalizedQuestions = normalizeQuestions(exam.questionsData);
  const correctCount = normalizedQuestions.reduce((count, question, index) => count + (answers[question.id] === question.correctIndex ? 1 : 0), 0);
  const total = normalizedQuestions.length;
  return {
    correctCount,
    total,
    percentage: total ? Math.round((correctCount / total) * 100) : 0,
  };
}
