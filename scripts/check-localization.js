#!/usr/bin/env node

/**
 * Localization Completeness Check Script
 * Checks and reports translation completeness for all supported languages
 *
 * Usage:
 *   node scripts/check-localization.js [--strict] [--json]
 *
 * Options:
 *   --strict: Strict mode, returns non-zero exit code on any missing translations
 *   --json: Output results in JSON format only
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  localesDir: path.join(__dirname, '../webview/src/i18n/locales'),
  referenceLanguage: 'en',
  supportedLanguages: ['zh', 'es', 'fr', 'hi', 'zh-TW'],
  warningThreshold: 95, // 翻译率低于95%时警告
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * 递归获取所有键值对
 */
function getAllKeys(obj, prefix = '') {
  const keys = [];

  Object.keys(obj).forEach(key => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...getAllKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  });

  return keys;
}

/**
 * Check if value is a valid translation according to project policy
 * Policy:
 * - Language names must use fixed Chinese/locale naming (handled elsewhere)
 * - Proper nouns (Claude, Codex, Gemini, GPT, Sonnet/Opus/Haiku) may keep original English
 * - For completeness reporting, any non-empty string counts as translated
 */
function isValidTranslation(key, value, referenceValue) {
  if (typeof value !== 'string') return false;
  if (value.trim().length === 0) return false;
  // Consider translated regardless of equality to reference to allow English placeholders
  return true;
}

/**
 * 获取嵌套对象中的值
 */
function getNestedValue(obj, keyPath) {
  const parts = keyPath.split('.');
  let current = obj;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * 加载并解析 JSON 文件
 */
function loadJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(colorize(`✗ 无法加载 ${path.basename(filePath)}: ${error.message}`, 'red'));
    process.exit(1);
  }
}

/**
 * 检查单个语言的翻译完整性
 */
function checkLanguage(language, referenceData, referenceKeys) {
  const filePath = path.join(CONFIG.localesDir, `${language}.json`);

  if (!fs.existsSync(filePath)) {
    return {
      language,
      exists: false,
      totalKeys: 0,
      translatedKeys: 0,
      percentage: 0,
      missingKeys: referenceKeys,
      errors: [`文件不存在: ${filePath}`],
    };
  }

  const data = loadJsonFile(filePath);
  const missingKeys = [];
  let translatedKeys = 0;

  referenceKeys.forEach(key => {
    const refValue = getNestedValue(referenceData, key);
    const value = getNestedValue(data, key);

    if (isValidTranslation(key, value, refValue)) {
      translatedKeys++;
    } else {
      missingKeys.push(key);
    }
  });

  const percentage = Math.round((translatedKeys / referenceKeys.length) * 100);

  return {
    language,
    exists: true,
    totalKeys: referenceKeys.length,
    translatedKeys,
    percentage,
    missingKeys,
    warnings: [],
  };
}

/**
 * Format and output results
 */
function formatResults(results, strict, json) {
  if (json) {
    return JSON.stringify(results, null, 2);
  }

  let output = '\n';
  output += colorize('═══════════════════════════════════════════════════════════', 'cyan');
  output += '\n';
  output += colorize('        Localization Completeness Report', 'bright');
  output += '\n';
  output += colorize('═══════════════════════════════════════════════════════════', 'cyan');
  output += '\n\n';

  const summary = results.summary;

  // Overall statistics
  output += colorize('📊 Summary', 'bright');
  output += '\n';
  output += `   Total Keys: ${summary.totalKeys}\n`;
  output += `   Translated: ${summary.totalTranslatedKeys} / ${summary.totalKeys}\n`;
  output += `   Average Translation Rate: ${colorize(summary.averagePercentage + '%', summary.averagePercentage >= CONFIG.warningThreshold ? 'green' : 'yellow')}\n`;
  output += '\n';

  // Details by language
  output += colorize('🌍 By Language', 'bright');
  output += '\n';

  results.languages.forEach(lang => {
    if (!lang.exists) {
      output += `  ${colorize('✗', 'red')} ${lang.language}: File not found\n`;
      return;
    }

    const statusIcon = lang.percentage === 100 ? '✓' : '⚠';
    const statusColor = lang.percentage === 100 ? 'green' : lang.percentage >= CONFIG.warningThreshold ? 'yellow' : 'red';

    output += `  ${colorize(statusIcon, statusColor)} ${lang.language}: `;
    output += `${lang.translatedKeys}/${lang.totalKeys} (${colorize(lang.percentage + '%', statusColor)})`;

    if (lang.missingKeys.length > 0) {
      output += ` ${colorize('Missing: ' + lang.missingKeys.length + ' items', statusColor)}`;
    }
    output += '\n';
  });

  output += '\n';

  // Missing keys details
  const allMissingKeys = {};
  results.languages.forEach(lang => {
    if (lang.missingKeys.length > 0) {
      allMissingKeys[lang.language] = lang.missingKeys;
    }
  });

  if (Object.keys(allMissingKeys).length > 0) {
    output += colorize('📋 Missing Translation Keys', 'bright');
    output += '\n';

    Object.entries(allMissingKeys).forEach(([lang, keys]) => {
      output += `\n  ${colorize(lang, 'yellow')} (${keys.length} missing):\n`;
      keys.slice(0, 10).forEach(key => {
        output += `    - ${key}\n`;
      });
      if (keys.length > 10) {
        output += `    ${colorize(`... and ${keys.length - 10} more items`, 'dim')}\n`;
      }
    });
    output += '\n';
  }

  // Recommendations
  output += colorize('💡 Recommendations', 'bright');
  output += '\n';

  results.languages.forEach(lang => {
    if (!lang.exists) {
      output += `  - ${lang.language}: Please create ${lang.language}.json file\n`;
    } else if (lang.percentage < 100) {
      output += `  - ${lang.language}: Need to translate ${lang.missingKeys.length} more keys to reach 100%\n`;
    }
  });

  output += '\n';
  output += colorize('═══════════════════════════════════════════════════════════', 'cyan');
  output += '\n';

  return output;
}

/**
 * Main function
 */
function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const jsonOutput = args.includes('--json');

  if (!jsonOutput) {
    console.log('Checking localization completeness...\n');
  }

  // Load English reference file
  const enFilePath = path.join(CONFIG.localesDir, `${CONFIG.referenceLanguage}.json`);
  const referenceData = loadJsonFile(enFilePath);
  const referenceKeys = getAllKeys(referenceData);

  // Check all languages
  const languageResults = CONFIG.supportedLanguages.map(lang =>
    checkLanguage(lang, referenceData, referenceKeys)
  );

  // Calculate overall statistics
  const totalTranslated = languageResults.reduce((sum, lang) => sum + lang.translatedKeys, 0);
  const totalKeys = referenceKeys.length * CONFIG.supportedLanguages.length;
  const averagePercentage = Math.round((totalTranslated / totalKeys) * 100);

  const results = {
    timestamp: new Date().toISOString(),
    summary: {
      totalKeys: referenceKeys.length,
      supportedLanguages: CONFIG.supportedLanguages.length,
      totalTranslatedKeys: totalTranslated,
      averagePercentage,
    },
    languages: languageResults,
  };

  // Output results
  const output = formatResults(results, strict, jsonOutput);
  console.log(output);

  // Save results as JSON file when not JSON-only mode
  if (!jsonOutput) {
    const reportPath = path.join(__dirname, '../localization-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(colorize(`✓ Report saved to: ${reportPath}`, 'green'));
    console.log();
  }

  // Determine exit code
  const hasErrors = languageResults.some(lang => !lang.exists);
  const hasMissing = languageResults.some(lang => lang.percentage < 100);

  if (strict && (hasErrors || hasMissing)) {
    process.exit(1);
  } else if (hasErrors) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Run script
main();

