import { readFileSync, readdirSync } from "node:fs";
import { analyzeEpisodes } from "../episode-detector";

type Sample = [number | null, string];

const SAMPLE_DIRECTORY = new URL("./sample/good/", import.meta.url);
const SAMPLE_FILES = readdirSync(SAMPLE_DIRECTORY)
  .filter((fileName) => fileName.endsWith(".json"))
  .sort();

function readSamples(sampleFile: string): Sample[] {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL(sampleFile, SAMPLE_DIRECTORY), "utf8"),
  );

  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (sample) =>
        Array.isArray(sample) &&
        sample.length === 2 &&
        (sample[0] === null || typeof sample[0] === "number") &&
        typeof sample[1] === "string",
    )
  ) {
    throw new Error(`${sampleFile} 应为“序号或 null、文件名”数组格式`);
  }

  return parsed as Sample[];
}

describe("good 样例文件识别测试", () => {
  expect(SAMPLE_FILES.length).toBeGreaterThan(0);

  test.each(SAMPLE_FILES)("%s 中的文件名都能正确识别", (sampleFile) => {
    const samples = readSamples(sampleFile);
    const results = analyzeEpisodes(
      samples.map(([, name], index) => ({ name, path: `/${index}` })),
    );
    const failures = results.flatMap((result, index) => {
      const expected = samples[index][0];
      const actual = Number.isNaN(result.bestNumber) ? null : result.bestNumber;
      return actual === expected
        ? []
        : [`期望 ${expected}，实际 ${actual}：${result.name}`];
    });

    expect(samples.length, `${sampleFile} 没有可校验的样例`).toBeGreaterThan(0);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
