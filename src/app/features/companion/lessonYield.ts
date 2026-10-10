// While a teaching lesson is on screen, the floating guide steps aside on phone-width screens: the lesson's right and wrong feedback
// sits where the guide floats. Wide screens keep the guide where it is. The guide returns when the lesson ends.
export const LESSON_YIELD_MAX_WIDTH = 720

export function yieldsToLesson(lessonOpen: boolean, viewportWidth: number): boolean {
  return lessonOpen && viewportWidth <= LESSON_YIELD_MAX_WIDTH
}
