export function validatePracticeAnswer(
  question: { options: string[]; correctIndex: number } | undefined,
  selectedAnswer: unknown,
) {
  if (!question || typeof selectedAnswer !== 'string' || !question.options.includes(selectedAnswer)) {
    throw new Error('Soru veya cevap geçersiz.');
  }
  return selectedAnswer === question.options[question.correctIndex];
}
