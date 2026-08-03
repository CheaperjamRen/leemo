export interface CommunitySkillFile {
  path: string;
  /** Defaults to `<upstreamPath>/<path>`. Used for the repository license,
   * which is installed beside the Skill as LICENSE.upstream. */
  sourcePath?: string;
  bytes: number;
  sha256: string;
}

export interface CommunitySkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  categoryLabel: string;
  author: string;
  repository: string;
  revision: string;
  upstreamPath: string;
  license: "MIT";
  licenseUrl: string;
  sourceUrl: string;
  files: CommunitySkillFile[];
}

/**
 * MVP distribution manifest. It is compiled into Leemo and must stay usable
 * without a Leemo-hosted catalog service. Network access happens only after a
 * user chooses Install, directly against the pinned upstream file URLs below.
 */
const MATT_REVISION = "2ab958093e83e0ec752e6c1c5932da465bf23e0c";
const SUPERPOWERS_REVISION = "44c9b2d6e889982ac18c27d05a19fefe335194e1";
const MATT_LICENSE: CommunitySkillFile = {
  path: "LICENSE.upstream",
  sourcePath: "LICENSE",
  bytes: 1068,
  sha256: "0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5",
};
const SUPERPOWERS_LICENSE: CommunitySkillFile = {
  path: "LICENSE.upstream",
  sourcePath: "LICENSE",
  bytes: 1070,
  sha256: "a37e0e9697144819e1d965176ac4ae5bc3fa02d11e7812036bbcadf6dafe2400",
};

function matt(
  input: Omit<CommunitySkillCatalogEntry, "repository" | "revision" | "license" | "licenseUrl" | "sourceUrl">,
): CommunitySkillCatalogEntry {
  return {
    ...input,
    repository: "mattpocock/skills",
    revision: MATT_REVISION,
    license: "MIT",
    licenseUrl: `https://github.com/mattpocock/skills/blob/${MATT_REVISION}/LICENSE`,
    sourceUrl: `https://github.com/mattpocock/skills/tree/${MATT_REVISION}/${input.upstreamPath}`,
    files: [...input.files, MATT_LICENSE],
  };
}

function superpowers(
  input: Omit<CommunitySkillCatalogEntry, "repository" | "revision" | "license" | "licenseUrl" | "sourceUrl">,
): CommunitySkillCatalogEntry {
  return {
    ...input,
    repository: "obra/superpowers",
    revision: SUPERPOWERS_REVISION,
    license: "MIT",
    licenseUrl: `https://github.com/obra/superpowers/blob/${SUPERPOWERS_REVISION}/LICENSE`,
    sourceUrl: `https://github.com/obra/superpowers/tree/${SUPERPOWERS_REVISION}/${input.upstreamPath}`,
    files: [...input.files, SUPERPOWERS_LICENSE],
  };
}

export const COMMUNITY_SKILL_CATALOG: readonly CommunitySkillCatalogEntry[] = [
  matt({
    id: "grill-me",
    name: "grill-me",
    description: "一次只追问一个关键问题，帮你把计划、想法或决策真正想清楚。",
    category: "thinking",
    categoryLabel: "思考与决策",
    author: "Matt Pocock",
    // Upstream's grill-me is only a wrapper around /grilling. Installing the
    // complete implementation under the familiar product name avoids a card
    // that appears usable but fails at invocation time.
    upstreamPath: "skills/productivity/grilling",
    files: [{ path: "SKILL.md", bytes: 843, sha256: "44331dda57f461db4fec3f2efb6ddabe7aaaa0a57ae0f88a883bc61aed8a0587" }],
  }),
  matt({
    id: "teach",
    name: "teach",
    description: "围绕长期目标建立课程、练习、学习记录和可复用参考资料。",
    category: "learning",
    categoryLabel: "学习",
    author: "Matt Pocock",
    upstreamPath: "skills/productivity/teach",
    files: [
      { path: "SKILL.md", bytes: 9507, sha256: "6d2dbe5e03084cf26fef66b535127b36cd1bcbe9478e26b0626029cd51dc2259" },
      { path: "GLOSSARY-FORMAT.md", bytes: 2131, sha256: "d177def491519d97873291f2e860d8f1d60ead78feecb82eee022177958069c6" },
      { path: "LEARNING-RECORD-FORMAT.md", bytes: 2777, sha256: "855f81017625256584bbf62bd5edb9b0c86605c4cc1139c56acc36b802595d17" },
      { path: "MISSION-FORMAT.md", bytes: 1553, sha256: "8da6d3ac84eb2eb19f17c260b6acf01c560d3ac7a4501c415eea0e985602f4d7" },
      { path: "RESOURCES-FORMAT.md", bytes: 1926, sha256: "2bc634a64b0d0daa10904f9222e7aa0d361420dfacabbf092fbe3a72222edc08" },
    ],
  }),
  matt({
    id: "edit-article",
    name: "edit-article",
    description: "重排文章结构、收紧表达并逐节改善清晰度与阅读节奏。",
    category: "writing",
    categoryLabel: "写作",
    author: "Matt Pocock",
    upstreamPath: "skills/personal/edit-article",
    files: [{ path: "SKILL.md", bytes: 752, sha256: "e10fba546f45357fe0aaa7494b9e186910d4525818d19f9b2ad6f28cc506aa5e" }],
  }),
  matt({
    id: "research",
    name: "research",
    description: "优先查找一手资料并把可追溯结论整理成研究笔记。",
    category: "research-office",
    categoryLabel: "资料与办公",
    author: "Matt Pocock",
    upstreamPath: "skills/engineering/research",
    files: [{ path: "SKILL.md", bytes: 799, sha256: "af378829f015775a3bcd65ff466826722e99359017ae6bae227ca4c9bd14049c" }],
  }),
  superpowers({
    id: "systematic-debugging",
    name: "systematic-debugging",
    description: "先定位根因、复现和验证，再动手修复异常行为。",
    category: "development",
    categoryLabel: "开发",
    author: "Jesse Vincent",
    upstreamPath: "skills/systematic-debugging",
    files: [
      { path: "SKILL.md", bytes: 9465, sha256: "808fc5717aa88ad65efff312b11c186294d3e6ee301afb584e2f86599b137787" },
      { path: "condition-based-waiting-example.ts", bytes: 5054, sha256: "40ae5ebe497fdf310200e43fe986552546d0a22837c0d39e855db1cfd33eb88e" },
      { path: "condition-based-waiting.md", bytes: 3516, sha256: "e89fec8400d6cd50f43407cec9fab50976ba4d55d0ec2eb51c0bd68036b54c26" },
      { path: "CREATION-LOG.md", bytes: 4257, sha256: "c24733a5b1821bd6bed1fc950261f0b9f4e90097e0bbb96459d8179713730789" },
      { path: "defense-in-depth.md", bytes: 3650, sha256: "1e175fb86fc357e58c6aebf5441e481e1b7868b4380c0456b63a17eefbd18ba7" },
      { path: "find-polluter.sh", bytes: 1986, sha256: "dd7b8f13c4cc2a24b33ff87b18da9248f3e1c80a085c3316224f69ff0fa5c43c" },
      { path: "root-cause-tracing.md", bytes: 5316, sha256: "6b0622269e098ca1399e123e553fd385f0b6412d88ef0e9c4f5a8ea9cf1cec7b" },
      { path: "test-academic.md", bytes: 653, sha256: "fe2ba480d78ac0d686dc025f41c2a32a43d642bf533f91b0c6053a04d35d6486" },
      { path: "test-pressure-1.md", bytes: 1900, sha256: "0b6a915db0054577819834c79be9eb614e97bddba10d73768e1fbe91cfed048a" },
      { path: "test-pressure-2.md", bytes: 2283, sha256: "b2030aeffba07050e8ad573ddf87486457c4a016a786bb326235bebd856f2016" },
      { path: "test-pressure-3.md", bytes: 2692, sha256: "96b50a52e2c7989c9cf20fb752c47c1e9a3a70dc362f8f7989f8f5b64dac7708" },
    ],
  }),
  superpowers({
    id: "test-driven-development",
    name: "test-driven-development",
    description: "先写能证明行为的失败测试，再用最小实现让它通过。",
    category: "development",
    categoryLabel: "开发",
    author: "Jesse Vincent",
    upstreamPath: "skills/test-driven-development",
    files: [
      { path: "SKILL.md", bytes: 9015, sha256: "bf1b8216e523851a411e91d429a7c1c2a173e79d88957bc78e348218d50edd54" },
      { path: "writing-good-tests.md", bytes: 8268, sha256: "51471c853306ff92ca8bb41dcaea05f31c0e46b03651f8f3c99754b7172f4ae1" },
    ],
  }),
  superpowers({
    id: "verification-before-completion",
    name: "verification-before-completion",
    description: "在宣称完成前运行新鲜、完整且能直接证明结论的验证。",
    category: "development",
    categoryLabel: "开发",
    author: "Jesse Vincent",
    upstreamPath: "skills/verification-before-completion",
    files: [{ path: "SKILL.md", bytes: 3646, sha256: "2befe7fc55bcadaa3d97dd9e8efeb633d2561c0ebe74c5a8b17c4d9e7e4520b3" }],
  }),
  superpowers({
    id: "receiving-code-review",
    name: "receiving-code-review",
    description: "先验证评审意见是否适合当前代码，再逐条实施或有依据地反驳。",
    category: "development",
    categoryLabel: "开发",
    author: "Jesse Vincent",
    upstreamPath: "skills/receiving-code-review",
    files: [{ path: "SKILL.md", bytes: 6203, sha256: "091df1629510af1b92fc4abd6f96732ebedb4cb2c0f3457e8f2740b0504a2438" }],
  }),
  superpowers({
    id: "requesting-code-review",
    name: "requesting-code-review",
    description: "在大改动或合并前组织一轮有上下文、有边界的独立代码评审。",
    category: "development",
    categoryLabel: "开发",
    author: "Jesse Vincent",
    upstreamPath: "skills/requesting-code-review",
    files: [
      { path: "SKILL.md", bytes: 2956, sha256: "d71cc01ba56d2325cf8af5f7c11837819b63ecd57de0bfdb812f7f3ff7751df8" },
      { path: "code-reviewer.md", bytes: 5213, sha256: "b2f2ec7596925fe52dac158fdfbca19b3a7d779d619c481e6706a6c0001662d3" },
    ],
  }),
] as const;

export function communityCatalogEntry(idOrName: string): CommunitySkillCatalogEntry | undefined {
  const key = idOrName.trim().toLocaleLowerCase();
  return COMMUNITY_SKILL_CATALOG.find((entry) => entry.id.toLocaleLowerCase() === key || entry.name.toLocaleLowerCase() === key);
}
