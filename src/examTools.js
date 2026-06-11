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

function clampQuestionCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(200, Math.round(parsed)));
}

export function buildGeneratedQuestions(exam) {
  const questionCount = clampQuestionCount(exam?.questions);
  const examTitle = String(exam?.title || 'الامتحان').trim() || 'الامتحان';

  return Array.from({ length: questionCount }, (_, index) => ({
    id: `${exam?.id || 'exam'}-q-${index + 1}`,
    text: `سؤال ${index + 1} - ${examTitle}`,
    options: [
      `الإجابة أ للسؤال ${index + 1}`,
      `الإجابة ب للسؤال ${index + 1}`,
      `الإجابة ج للسؤال ${index + 1}`,
      `الإجابة د للسؤال ${index + 1}`,
    ],
    correctIndex: index % 4,
  }));
}

export function ensureExamQuestionsData(exam) {
  if (!exam || typeof exam !== 'object') return null;

  const normalizedQuestions = normalizeQuestions(exam.questionsData);
  const questionCount = clampQuestionCount(exam.questions ?? normalizedQuestions.length);
  const questionsData = normalizedQuestions.length > 0
    ? normalizedQuestions
    : buildGeneratedQuestions({ ...exam, questions: questionCount });

  return {
    ...exam,
    questions: questionCount || questionsData.length,
    questionsData,
  };
}

export function gradeAnswers(exam, answers) {
  const normalizedQuestions = ensureExamQuestionsData(exam)?.questionsData ?? [];
  const correctCount = normalizedQuestions.reduce((count, question, index) => count + (answers[question.id] === question.correctIndex ? 1 : 0), 0);
  const total = normalizedQuestions.length;
  return {
    correctCount,
    total,
    percentage: total ? Math.round((correctCount / total) * 100) : 0,
  };
}
