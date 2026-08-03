// Leemo — 一次嵌套搜索请求的**降级计划**（轮 4 卡 H3）。
//
// 把"这家能不能搜"（catalog 里的实测数据）和"怎么降级"（search-shim 的逐层逻辑）
// 之间那一步单独拎出来：前者是可测的数据，后者是可测的逻辑，两者不该缠在一起。
//
// 产出的层序（**只有本对话这一家自己的路**）：
//   层① passthrough  它自己的端点能搜 ⇒ 原样转发（DeepSeek / Kimi）
//   层② vendorSearch 它自己有独立搜索 API ⇒ 转译（GLM）
//   （层③ 外部源在 shim 里，不需要选择）
//
// ── 一条硬边界：**绝不跨 provider**（用户 7/27 拍板）─────────────────────────
//
// 我原先在这里做了"层③ 跨家借"：通义两条原生路都不成立时，去借用户另一家已配置好的
// provider（GLM/DeepSeek/Kimi）的原生搜索。理由是"仍然是用户自己的 key、不碰第三方"。
//
// **用户否掉了，理由比我的更硬**：用户选了这个 API 就是只想花这个 API 的额度。用通义
// 聊天时自动去扣 GLM 的搜索额度，是他从没同意过的支出 —— 这比掉到 Tavily/AnySearch
// **更坏**，因为外部源要么免 key、要么是他自己为搜索单独配的 key，两者他都知情。
//
// 所以本文件只看 `selfId` 那一个条目，**从不遍历 catalog 找别家**。`SearchPlan` 那侧
// 也把跨家候选从类型里删掉了（单槽位而非列表），谁想加回来必须先改契约。
import type { CatalogEntry } from "./provider-catalog";
import type { SearchPlan } from "./search-shim";
import { searchGlmNative, vendorSearchAdapter } from "./vendor-search";

/**
 * 现算计划。每次搜索都重算一次（不缓存）—— 用户在设置页换了 key、改了 baseUrl，
 * 下一次搜索就该用上，与 getCatalog / loadSearchKeys 同一条纪律。
 *
 * @param catalog 活的 catalog
 * @param selfId  本对话那一家的 provider id —— **计划只会用到它这一条**
 */
export function buildSearchPlan(catalog: CatalogEntry[], selfId: string, fetchFn: typeof fetch): SearchPlan {
  const self = catalog.find((e) => e.provider.id === selfId);
  // 没有 key ⇒ 什么都发不出去（预置项在 catalog 里永远列着，给设置页看"还能配哪些
  // 家"，拿它去搜只会换回一个 401）。
  if (!self || !self.provider.apiKey.trim()) return {};

  // openai 家走网关做协议翻译，不经过 shim；网关会把服务端工具**剥掉** ⇒ 透传只会
  // 换回空壳。那些家继续走自建 MCP。
  if (self.provider.apiFormat !== "anthropic") return {};

  const plan: SearchPlan = {};
  const spec = self.nativeSearch;

  // ── 层①：实测能透传的家给；实测**不能**的（vendorApi / none）不给 —— 白花一轮
  // 模型生成换个空壳（GLM 实测 3~9s + token 费）。未实测的家（中转站/自建端点）给，
  // 由 shim 的空壳判据探一次并记住结果。
  if (spec?.mode === "passthrough" || spec === undefined) {
    plan.passthrough = {
      baseUrl: self.provider.baseUrl,
      apiKey: self.provider.apiKey,
      ...(self.apiKeyHeader ? { apiKeyHeader: self.apiKeyHeader } : {}),
      ...(self.headers ? { headers: { ...self.headers } } : {}),
    };
  }

  // ── 层②：它自己的搜索 API。
  if (spec?.mode === "vendorApi" && spec.searchApiUrl) {
    const adapter = vendorSearchAdapter(spec.vendor) ?? (spec.vendor === "glm" ? searchGlmNative : undefined);
    if (adapter) {
      const searchApiUrl = spec.searchApiUrl;
      const apiKey = self.provider.apiKey;
      plan.vendorSearch = { id: self.provider.id, search: (q) => adapter(q, { apiKey, searchApiUrl, fetchFn }) };
    }
  }

  return plan;
}
