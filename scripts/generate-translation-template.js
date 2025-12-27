#!/usr/bin/env node

/**
 * 本地化翻译模板生成脚本
 * 用于生成缺失翻译的模板文件，便于翻译人员快速补充
 *
 * 使用方式:
 *   node scripts/generate-translation-template.js [language]
 *
 * 示例:
 *   node scripts/generate-translation-template.js es
 *   node scripts/generate-translation-template.js zh-TW
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  localesDir: path.join(__dirname, '../webview/src/i18n/locales'),
  referenceLanguage: 'en',
};

/**
 * 递归获取所有键值对（保留嵌套结构）
 */
function getAllKeysWithStructure(obj, prefix = '') {
  const result = {};

  Object.keys(obj).forEach(key => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[fullKey] = getAllKeysWithStructure(value, fullKey);
    } else {
      result[fullKey] = value;
    }
  });

  return result;
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
 * 设置嵌套对象中的值
 */
function setNestedValue(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * 加载 JSON 文件
 */
function loadJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * 生成翻译模板
 */
function generateTemplate(language) {
  const refPath = path.join(CONFIG.localesDir, `${CONFIG.referenceLanguage}.json`);
  const langPath = path.join(CONFIG.localesDir, `${language}.json`);

  // 加载参考文件（英文）
  const referenceData = loadJsonFile(refPath);
  if (!referenceData) {
    console.error(`✗ 无法加载参考文件: ${refPath}`);
    process.exit(1);
  }

  // 加载目标语言文件（如果存在）
  const languageData = loadJsonFile(langPath) || {};

  // 找出缺失的翻译
  const template = {};
  let missingCount = 0;

  function findMissing(refObj, langObj, prefix = '') {
    Object.keys(refObj).forEach(key => {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const refValue = refObj[key];
      const langValue = langObj[key];

      if (typeof refValue === 'object' && refValue !== null && !Array.isArray(refValue)) {
        const nextLangObj = typeof langValue === 'object' && langValue !== null ? langValue : {};
        findMissing(refValue, nextLangObj, fullKey);
      } else {
        // 检查是否需要翻译
        if (!langValue || langValue === refValue) {
          setNestedValue(template, fullKey, {
            english: refValue,
            translation: '[待翻译]',
            notes: '',
          });
          missingCount++;
        }
      }
    });
  }

  findMissing(referenceData, languageData);

  if (missingCount === 0) {
    console.log(`✓ ${language}.json 已完全翻译，无缺失项！`);
    process.exit(0);
  }

  // 生成模板文件
  const templatePath = path.join(
    CONFIG.localesDir,
    `${language}.translation-template.json`
  );

  const output = {
    language,
    generatedAt: new Date().toISOString(),
    totalMissing: missingCount,
    instructions: `
请将以下缺失的翻译项进行翻译：
1. 找到每个 "translation" 字段
2. 将 "[待翻译]" 替换为对应的 ${language} 翻译
3. "english" 字段显示英文原文，仅供参考
4. 完成后删除 "notes" 字段
5. 将翻译内容复制到 ${language}.json 对应位置
    `.trim(),
    missingKeys: template,
  };

  fs.writeFileSync(templatePath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`✓ 翻译模板已生成: ${templatePath}`);
  console.log(`✓ 共 ${missingCount} 项待翻译`);
  console.log('\n📝 使用说明:');
  console.log('  1. 打开生成的模板文件');
  console.log('  2. 找到所有 "[待翻译]" 项并填写翻译');
  console.log('  3. 使用本地化应用或手动复制回原文件');
  console.log('  4. 运行 check-localization 脚本验证翻译完整性');
}

/**
 * 主函数
 */
function main() {
  const language = process.argv[2];

  if (!language) {
    console.error('✗ 请指定目标语言');
    console.error('使用方式: node scripts/generate-translation-template.js [language]');
    console.error('示例: node scripts/generate-translation-template.js es');
    process.exit(1);
  }

  console.log(`正在为 ${language} 生成翻译模板...\n`);
  generateTemplate(language);
}

main();

