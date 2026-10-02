import { db } from "@workspace/db";
import { ApiError, audit, type Actor } from "../core";
import { financeTransaction } from "../finance/posting";
import { seedScales } from "./service";

// Editable planning starters, not an assertion of an exhaustive official syllabus.
const common = {
  English: ["Listening and speaking", "Reading", "Writing", "Language use"],
  Kiswahili: ["Kusikiliza na kuzungumza", "Kusoma", "Kuandika", "Matumizi ya lugha"],
  Mathematics: ["Numbers", "Measurement", "Geometry", "Data handling"],
  Science: ["Living things", "Materials", "Energy", "Environment"],
  SocialStudies: ["Our community", "Natural environment", "Citizenship", "Resources"],
  CreativeArts: ["Visual arts", "Music", "Movement and performance"],
  ReligiousEducation: ["Beliefs and values", "Community and service", "Responsible living"],
  Agriculture: ["Plants and soil", "Animal care", "Food production", "Sustainable practices"],
  PreTechnicalStudies: ["Safety", "Tools and materials", "Design and making", "Digital skills"],
};
const bands: Record<string, Record<string, string[]>> = {
  pre_primary: { LanguageActivities: ["Listening and speaking", "Pre-reading", "Pre-writing"], MathematicalActivities: ["Sorting and matching", "Numbers", "Shapes and space"], EnvironmentalActivities: ["Self and family", "Our surroundings", "Health and safety"], PsychomotorCreativeActivities: ["Movement", "Art and music"], ReligiousActivities: ["Values", "Caring for others"] },
  lower_primary: { English: common.English, Kiswahili: common.Kiswahili, IndigenousLanguage: common.English, MathematicalActivities: common.Mathematics, EnvironmentalActivities: common.Science, CreativeActivities: common.CreativeArts, ReligiousEducation: common.ReligiousEducation },
  upper_primary: { English: common.English, Kiswahili: common.Kiswahili, Mathematics: common.Mathematics, ScienceTechnology: common.Science, SocialStudies: common.SocialStudies, AgricultureNutrition: common.Agriculture, CreativeArts: common.CreativeArts, ReligiousEducation: common.ReligiousEducation },
  junior: { English: common.English, Kiswahili: common.Kiswahili, Mathematics: common.Mathematics, IntegratedScience: common.Science, SocialStudies: common.SocialStudies, AgricultureNutrition: common.Agriculture, PreTechnicalStudies: common.PreTechnicalStudies, CreativeArtsSports: common.CreativeArts, ReligiousEducation: common.ReligiousEducation },
  senior: { English: common.English, Kiswahili: common.Kiswahili, Mathematics: common.Mathematics, Biology: common.Science, Chemistry: ["Matter", "Chemical reactions", "Laboratory practice"], Physics: ["Mechanics", "Waves", "Electricity"], HistoryGovernment: common.SocialStudies, Geography: ["Physical geography", "Human geography", "Fieldwork"], BusinessStudies: ["Enterprise", "Markets", "Financial literacy"], ComputerScience: ["Computing systems", "Programming", "Data and networks"], Agriculture: common.Agriculture, VisualPerformingArts: common.CreativeArts, SportsRecreation: ["Physical fitness", "Games", "Sports health"] },
};
export async function seedCurriculum(actor: Actor) {
  await seedScales(actor);
  return financeTransaction(actor, async tx => {
    const grades = await tx.grade.findMany({ where: { schoolId: actor.school.id } });
    let created = 0;
    for (const grade of grades) {
      const normalized = grade.levelBand.replace(/_school$/, "").replace("junior_secondary", "junior").replace("senior_secondary", "senior");
      const areas = bands[normalized];
      if (!areas) throw new ApiError(400, `No starter curriculum for level band ${grade.levelBand}`);
      const scale = await tx.performanceScale.findFirstOrThrow({ where: { schoolId: actor.school.id, name: `${normalized === "junior" || normalized === "senior" ? 8 : 4}-level school rubric (editable bands)` } });
      await tx.gradeScale.upsert({ where: { gradeId: grade.id }, create: { schoolId: actor.school.id, gradeId: grade.id, scaleId: scale.id }, update: {} });
      for (const [code, strands] of Object.entries(areas)) {
        const area = await tx.learningArea.upsert({ where: { schoolId_gradeId_code: { schoolId: actor.school.id, gradeId: grade.id, code } }, create: { schoolId: actor.school.id, gradeId: grade.id, code, name: code.replace(/([A-Z])/g, " $1").trim(), isCore: normalized !== "senior" || ["English", "Kiswahili", "Mathematics"].includes(code), pathway: normalized === "senior" ? ["Biology", "Chemistry", "Physics", "ComputerScience", "Agriculture"].includes(code) ? "STEM" : ["VisualPerformingArts", "SportsRecreation"].includes(code) ? "Arts and sports" : "Social sciences" : null }, update: {} });
        for (let i = 0; i < strands.length; i++) {
          let strand = await tx.curriculumStrand.findFirst({ where: { schoolId: actor.school.id, learningAreaId: area.id, parentId: null, name: strands[i] } });
          if (!strand) { strand = await tx.curriculumStrand.create({ data: { schoolId: actor.school.id, learningAreaId: area.id, name: strands[i], order: i + 1 } }); created++; }
          for (const [j, skill] of ["Knowledge and understanding", "Practical application", "Reflection and communication"].entries()) {
            if (!await tx.curriculumStrand.findFirst({ where: { schoolId: actor.school.id, parentId: strand.id, name: skill } })) {
              await tx.curriculumStrand.create({ data: { schoolId: actor.school.id, learningAreaId: area.id, parentId: strand.id, name: skill, order: j + 1 } }); created++;
            }
          }
        }
      }
    }
    await audit(tx, actor, "seeded", "curriculum", undefined, undefined, { created, scope: "editable planning starters, not official exhaustive syllabus" });
    return { status: "seeded", message: `${created} new strands/sub-strands; existing edits preserved. Review and adapt school planning starters.` };
  });
}