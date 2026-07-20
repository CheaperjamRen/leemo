import JSON5 from "json5";
import { jsonrepair } from "jsonrepair";

/**
 * 解析工具调用参数的函数
 * Parse tool call arguments function
 * 先尝试标准JSON解析，然后JSON5解析，最后使用jsonrepair进行安全修复
 * First try standard JSON parsing, then JSON5 parsing, finally use jsonrepair for safe repair
 * 
 * @param argsString - 需要解析的参数字符串 / Parameter string to parse
 * @returns 解析后的参数对象或安全的空对象 / Parsed parameter object or safe empty object
 */
export function parseToolArguments(argsString: string, logger?: any): string {
  // Handle empty or null input
  if (!argsString || argsString.trim() === "" || argsString === "{}") {
    return "{}";
  }

  try {
    // First attempt: Standard JSON parsing
    JSON.parse(argsString);
    logger?.debug(`工具调用参数标准JSON解析成功 / Tool arguments standard JSON parsing successful`);
    return argsString;
  } catch (jsonError: any) {
    try {
      // Second attempt: JSON5 parsing for relaxed syntax
      const args = JSON5.parse(argsString);
      logger?.debug(`工具调用参数JSON5解析成功 / Tool arguments JSON5 parsing successful`);
      return JSON.stringify(args);
    } catch (json5Error: any) {
      try {
        // Third attempt: Safe JSON repair without code execution
        const repairedJson = jsonrepair(argsString);
        logger?.debug(`工具调用参数安全修复成功 / Tool arguments safely repaired`);
        return repairedJson;
      } catch (repairError: any) {
        // All parsing attempts failed - log errors and return safe fallback
        logger?.error(
          `JSON解析失败 / JSON parsing failed: ${jsonError.message}. ` +
          `JSON5解析失败 / JSON5 parsing failed: ${json5Error.message}. ` +
          `JSON修复失败 / JSON repair failed: ${repairError.message}. ` +
          `输入数据 / Input data: ${JSON.stringify(argsString)}`
        );
        
        // Return safe empty object as fallback instead of potentially malformed input
        logger?.debug(`返回安全的空对象作为后备方案 / Returning safe empty object as fallback`);
        return "{}";
      }
    }
  }
}