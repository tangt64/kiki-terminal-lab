export function normalizeCourseType(course = {}) {
  return String(course?.courseType || "standard").trim().toLowerCase();
}

export function isStandaloneExamCourse(course = {}) {
  return normalizeCourseType(course) === "exam";
}

export function getStandaloneExamCourseIds(courses = []) {
  return new Set(
    (Array.isArray(courses) ? courses : [])
      .filter(isStandaloneExamCourse)
      .map((course) => Number(course?.id || 0))
      .filter((courseId) => Number.isInteger(courseId) && courseId > 0),
  );
}

export function isLearningLabResource(lab = {}, examCourseIds = new Set()) {
  const courseId = Number(lab?.courseId || 0);
  return String(lab?.purpose || "learning").trim().toLowerCase() !== "exam"
    && !String(lab?.examSessionId || "").trim()
    && (!courseId || !examCourseIds.has(courseId));
}
