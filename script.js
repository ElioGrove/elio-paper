// script.js
// Paper - 轻量级微信公众号 Markdown 编辑器主要功能文件

(function (root) {
  'use strict';

  const FAIL_CLOSED_MESSAGE = '安全组件 (DOMPurify) 未加载，已阻止渲染未清洗的 HTML 内容。请检查网络连接后刷新页面重试。';

  // 配置常量
  const CONFIG = {
    LIBRARY_TIMEOUT_MS: 12000,
    LIBRARY_POLL_MS: 100,
    RENDER_DEBOUNCE_MS: 140,
    AUTO_SAVE_DELAY_MS: 1000,
    PREVIEW_WIDTH: 578,
    ZOOM_MAX: 1.5,
    ZOOM_MIN: 0.5,
    ZOOM_STEP: 0.25
  };

  // HTML 特殊字符转义
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 解码常见 HTML 实体（避免 Showdown 输出被二次转义或绕过校验）
  function decodeBasicHtmlEntities(value) {
    return String(value == null ? '' : value)
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&#x27;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
  }

  // URL 安全校验：仅允许 http:、https: 与安全的栅格 data:image/ 协议
  function sanitizeUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return '';
    const cleaned = rawUrl.trim().replace(/[\u0000-\u001F\u007F]+/g, '');
    if (!cleaned) return '';

    if (/^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|ico)(?:;charset=[a-z0-9-]+)?(?:;base64)?,/i.test(cleaned)) {
      return cleaned;
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) {
      try {
        const parsed = new URL(cleaned);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return parsed.href;
        }
      } catch (e) {
        return '';
      }
    }

    return '';
  }

  // 安全解码 URI 组件，避免异常百分号序列抛出 URIError
  function safeDecodeURIComponent(str) {
    try {
      return decodeURIComponent(str);
    } catch (e) {
      return str;
    }
  }

  // 处理引用链接
  function processReferences(html) {
    const references = [];
    let refIndex = 1;

    // 在安全链接后面添加引用标记，移除不安全协议链接
    html = html.replace(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (match, rawUrl, rawText) => {
      const decodedUrl = decodeBasicHtmlEntities(rawUrl);
      const safeUrl = sanitizeUrl(decodedUrl);
      const plainText = decodeBasicHtmlEntities(rawText.replace(/<[^>]+>/g, '')).trim();

      if (!safeUrl) {
        return escapeHtml(plainText);
      }

      references.push({ url: safeUrl, text: plainText || safeUrl });
      return `${match}<span class="reference-link">[${refIndex++}]</span>`;
    });

    // 如果有引用，添加引用列表
    if (references.length > 0) {
      let referencesHtml = '<div class="references"><h4>引用链接</h4><ol>';
      references.forEach((ref) => {
        referencesHtml += `<li>${escapeHtml(ref.text)}: ${escapeHtml(ref.url)}</li>`;
      });
      referencesHtml += '</ol></div>';
      html += referencesHtml;
    }

    return html;
  }

  // 处理信息卡片
  function processInfoCards(markdownText) {
    const codeBlocks = [];
    let codeBlockIndex = 0;

    // 先保护代码块内容（包括行内代码和多行代码块）
    markdownText = markdownText.replace(/```[\s\S]*?```|`[^`]+`/g, (match) => {
      const placeholder = `__CODE_BLOCK_${codeBlockIndex}__`;
      codeBlocks[codeBlockIndex] = match;
      codeBlockIndex++;
      return placeholder;
    });

    // 处理 :::info 标记的信息卡片（对标题与内容均编码，避免属性注入）
    markdownText = markdownText.replace(/:::info[ \t]*(.*?)\n([\s\S]*?):::/g, (match, title, content) => {
      return `<div class="info-card-placeholder" data-title="${encodeURIComponent(title.trim())}" data-content="${encodeURIComponent(content.trim())}"></div>`;
    });

    // 处理 :::orange 标记的浅橙色卡片（无标题）
    markdownText = markdownText.replace(/:::orange\n([\s\S]*?):::/g, (match, content) => {
      return `<div class="orange-card-placeholder" data-content="${encodeURIComponent(content.trim())}"></div>`;
    });

    // 处理 :::blue 标记的浅蓝色卡片（无标题）
    markdownText = markdownText.replace(/:::blue\n([\s\S]*?):::/g, (match, content) => {
      return `<div class="blue-card-placeholder" data-content="${encodeURIComponent(content.trim())}"></div>`;
    });

    // 恢复代码块内容（使用函数返回值避免 $& / $$ 触发特殊替换）
    codeBlocks.forEach((codeBlock, index) => {
      markdownText = markdownText.replace(`__CODE_BLOCK_${index}__`, () => codeBlock);
    });

    return markdownText;
  }

  // 卡片内部内容清理公共函数
  function formatCardContent(content, converter) {
    let processedContent = converter.makeHtml(content);
    processedContent = processedContent.replace(/<p>/g, '').replace(/<\/p>/g, '<br><br>');
    processedContent = processedContent.replace(/<br><br>$/, '');
    processedContent = processedContent.replace(/<img([^>]*)>/g, '<img$1 style="max-width: 100%; height: auto; display: block; margin: 6px 0;">');
    processedContent = processedContent
      .replace(/(?:<br\s*\/?>\s*)+(<img[^>]*>)/g, '$1')
      .replace(/(<img[^>]*>)(?:\s*<br\s*\/?>)+/g, '$1');
    return processedContent;
  }

  // 处理信息卡片占位符
  function processInfoCardPlaceholders(html, converter) {
    // 处理 info 卡片
    html = html.replace(/<div class="info-card-placeholder" data-title="([^"]*)" data-content="([^"]*)"><\/div>/g, (match, encodedTitle, encodedContent) => {
      const title = escapeHtml(safeDecodeURIComponent(encodedTitle));
      const content = safeDecodeURIComponent(encodedContent);
      const processedContent = formatCardContent(content, converter);

      return `<table style="width: 100%; margin: 12px 0; border-collapse: separate; border-spacing: 0;">
          <tr>
            <td style="background-color: #D0F9D0; border: none; padding: 8px 16px 12px 16px; border-radius: 8px;">
              <p style="margin: 0 0 6px 0; color: #d32f2f; font-weight: bold; font-size: 16px;">
                💡 ${title}
              </p>
              <p style="margin: 0; color: #333; line-height: 1.6;">
                ${processedContent}
              </p>
            </td>
          </tr>
        </table>`;
    });

    // 处理 orange 卡片（无标题）
    html = html.replace(/<div class="orange-card-placeholder" data-content="([^"]*)"><\/div>/g, (match, encodedContent) => {
      const content = safeDecodeURIComponent(encodedContent);
      const processedContent = formatCardContent(content, converter);

      return `<table style="width: 100%; margin: 12px 0; border-collapse: separate; border-spacing: 0;">
          <tr>
            <td style="background-color: #FFF3E0; border: none; padding: 12px 16px; border-radius: 8px;">
              <p style="margin: 0; color: #333; line-height: 1.8;">
                ${processedContent}
              </p>
            </td>
          </tr>
        </table>`;
    });

    // 处理 blue 卡片（无标题）
    html = html.replace(/<div class="blue-card-placeholder" data-content="([^"]*)"><\/div>/g, (match, encodedContent) => {
      const content = safeDecodeURIComponent(encodedContent);
      const processedContent = formatCardContent(content, converter);

      return `<table style="width: 100%; margin: 12px 0; border-collapse: separate; border-spacing: 0;">
          <tr>
            <td style="background-color: #E3F2FD; border: none; padding: 12px 16px; border-radius: 8px;">
              <p style="margin: 0; color: #333; line-height: 1.8;">
                ${processedContent}
              </p>
            </td>
          </tr>
        </table>`;
    });

    return html;
  }

  // 处理横屏滑动幻灯片
  function processSlideshow(markdownText) {
    const codeBlocks = [];
    let codeBlockIndex = 0;

    // 先保护代码块内容
    markdownText = markdownText.replace(/```[\s\S]*?```|`[^`]+`/g, (match) => {
      const placeholder = `__CODE_BLOCK_${codeBlockIndex}__`;
      codeBlocks[codeBlockIndex] = match;
      codeBlockIndex++;
      return placeholder;
    });

    const slideshowRegex = /(^|\s|>\s*)\n?<!\[([^\]]*)\]\(([^)]+)\)(?:,\s*!\[([^\]]*)\]\(([^)]+)\))+>(?=\s|$|\n)/gm;

    markdownText = markdownText.replace(slideshowRegex, (match, prefix) => {
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      const images = [];
      let imageMatch;

      while ((imageMatch = imageRegex.exec(match)) !== null) {
        const safeUrl = sanitizeUrl(imageMatch[2]);
        if (safeUrl) {
          images.push({
            alt: imageMatch[1] || '',
            url: safeUrl
          });
        }
      }

      if (images.length === 0) return prefix;

      let slideshowHTML = '<section style="box-sizing: border-box; font-size: 16px; margin: 20px 0;">';
      slideshowHTML += '<section style="font-family: 微软雅黑; font-size: 16px;">';
      slideshowHTML += '<section style="margin: 0px auto; box-sizing: border-box; width: 100%;">';
      slideshowHTML += '<section style="margin: 0px auto; text-align: center;">';
      slideshowHTML += '<section style="display: inline-block; width: 100%;">';
      slideshowHTML += '<section style="overflow-x: scroll; overflow-y: hidden; -webkit-overflow-scrolling: touch; white-space: nowrap; width: 100%; text-align: center;">';

      images.forEach((img) => {
        const safeAlt = escapeHtml(img.alt || 'picture');
        const safeSrc = escapeHtml(img.url);
        slideshowHTML += '<section style="display: inline-block; width: 90%; margin-right: 10px; vertical-align: top;">';
        slideshowHTML += `<img style="display: block; width: 100%; height: auto; margin: 0.1em auto 0.2em; border: 1px solid rgba(0, 0, 0, 0.04); vertical-align: top;" title="${safeAlt}" alt="${safeAlt}" src="${safeSrc}">`;
        slideshowHTML += `<p style="margin: 0; font-size: 12px; color: #333; text-align: center; white-space: normal; line-height: 1.2;">${safeAlt}</p>`;
        slideshowHTML += '</section>';
      });

      slideshowHTML += '</section>';
      slideshowHTML += '</section>';
      slideshowHTML += '</section>';
      slideshowHTML += '</section>';
      slideshowHTML += '</section>';
      slideshowHTML += '<section style="text-align: center; margin: 4px 0 0 0; padding: 0;"><p style="font-size: 12px; color: #333; text-align: center; margin: 0; padding: 0; line-height: 1.5;">&lt;&lt;&lt; 左右滑动看更多 &gt;&gt;&gt;</p></section>';
      slideshowHTML += '</section>';

      return prefix + slideshowHTML;
    });

    // 恢复代码块内容
    codeBlocks.forEach((codeBlock, index) => {
      markdownText = markdownText.replace(`__CODE_BLOCK_${index}__`, () => codeBlock);
    });

    return markdownText;
  }

  // Fail-Closed HTML 清洗与渲染：若 DOMPurify 不可用，绝不写入 innerHTML
  function renderSafeHtml(rawHtml, previewEl, purify) {
    if (!purify || typeof purify.sanitize !== 'function') {
      if (previewEl) {
        previewEl.textContent = FAIL_CLOSED_MESSAGE;
      }
      return false;
    }

    const cleanHtml = purify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
    if (previewEl) {
      previewEl.innerHTML = cleanHtml;
    }
    return true;
  }

  // 应用代码高亮（尊重已声明的语言类，仅在未指定时由 highlight.js 自动检测）
  function highlightCodeBlocks(previewEl, hljsLib, doc) {
    if (!previewEl || !hljsLib || typeof hljsLib.highlightElement !== 'function') {
      return;
    }

    const codeBlocks = previewEl.querySelectorAll('pre code');
    codeBlocks.forEach((block, index) => {
      if (block.hasAttribute('data-highlighted')) {
        return;
      }

      try {
        hljsLib.highlightElement(block);
      } catch (e) {
        console.error(`Error highlighting block ${index}:`, e);
      }
    });

    const documentRef = doc || previewEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!documentRef) return;
    const preBlocks = previewEl.querySelectorAll('pre');
    preBlocks.forEach((pre) => {
      if (!pre.querySelector('.mac-sign')) {
        const macSign = documentRef.createElement('span');
        macSign.className = 'mac-sign';
        macSign.style.cssText = 'display: flex; padding: 12px 12px 0;';
        macSign.innerHTML = `<svg viewBox="0 0 450 130" height="13px" width="45px" y="0px" x="0px" version="1.1" xmlns="http://www.w3.org/2000/svg">
          <ellipse fill="rgb(237,108,96)" stroke-width="2" stroke="rgb(220,60,54)" ry="52" rx="50" cy="65" cx="50"></ellipse>
          <ellipse fill="rgb(247,193,81)" stroke-width="2" stroke="rgb(218,151,33)" ry="52" rx="50" cy="65" cx="225"></ellipse>
          <ellipse fill="rgb(100,200,86)" stroke-width="2" stroke="rgb(27,161,37)" ry="52" rx="50" cy="65" cx="400"></ellipse>
        </svg>`;
        pre.insertBefore(macSign, pre.firstChild);
      }
    });
  }

  // 等待核心依赖库加载完成（带超时保护，避免无限轮询）
  function waitForLibraries(options) {
    const opts = options || {};
    const win = opts.win || (typeof window !== 'undefined' ? window : {});
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : CONFIG.LIBRARY_TIMEOUT_MS;
    const pollMs = typeof opts.pollMs === 'number' ? opts.pollMs : CONFIG.LIBRARY_POLL_MS;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const getMissingLibraries = () => {
        const missing = [];
        if (!win.hljs) missing.push('highlight.js');
        if (!win.showdown) missing.push('Showdown');
        if (!win.CodeMirror) missing.push('CodeMirror');
        if (!win.DOMPurify || typeof win.DOMPurify.sanitize !== 'function') missing.push('DOMPurify');
        return missing;
      };

      const checkLibraries = () => {
        const missing = getMissingLibraries();
        if (missing.length === 0) {
          resolve();
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          reject(new Error(`核心依赖库加载超时：${missing.join('、')}。请检查网络连接后刷新页面重试。`));
          return;
        }
        setTimeout(checkLibraries, pollMs);
      };

      checkLibraries();
    });
  }

  // ---- 样式内联辅助函数（用于「复制到公众号」） ----

  function isInfoCardTd(el) {
    if (!el || !el.tagName || el.tagName.toLowerCase() !== 'td') return false;
    const style = (el.getAttribute && el.getAttribute('style')) || '';
    return (
      style.includes('#D0F9D0') ||
      style.includes('#FFF3E0') ||
      style.includes('#E3F2FD') ||
      style.includes('rgb(208, 249, 208)') ||
      style.includes('rgb(255, 243, 224)') ||
      style.includes('rgb(227, 242, 253)')
    );
  }

  function isInfoCardTable(el) {
    if (!el || !el.tagName || el.tagName.toLowerCase() !== 'table') return false;
    if (typeof el.querySelectorAll !== 'function') return false;
    return Array.from(el.querySelectorAll('td')).some(isInfoCardTd);
  }

  function isHljsElement(el) {
    if (!el || !el.classList) return false;
    for (let i = 0; i < el.classList.length; i++) {
      const cls = el.classList[i];
      if (cls === 'hljs' || cls.startsWith('hljs-')) {
        return true;
      }
    }
    return false;
  }

  function isTransparentOrUiBg(val) {
    if (!val) return true;
    const normalized = val.trim().toLowerCase();
    return (
      normalized === 'transparent' ||
      normalized === 'none' ||
      normalized === 'rgba(0, 0, 0, 0)' ||
      normalized.includes('248, 250, 252') ||
      normalized.includes('#f8fafc')
    );
  }

  function isDefaultBorderValue(prop, val) {
    if (!prop.startsWith('border') || prop === 'border-radius' || prop === 'border-collapse') {
      return false;
    }
    return /^0px\s+none\b/i.test(val.trim());
  }

  // 递归为已挂载元素及其子元素注入计算后的行内样式
  function inlineStyles(el, win) {
    if (!el || !el.tagName) return;
    const view = win || (typeof window !== 'undefined' ? window : null);
    if (!view || typeof view.getComputedStyle !== 'function') return;

    const tag = el.tagName.toLowerCase();

    // SVG 及内部图形元素保持原始属性不变（HTML 文档中 SVG tagName 为小写）
    if (tag === 'svg' || tag === 'ellipse' || el.namespaceURI === 'http://www.w3.org/2000/svg') {
      Array.from(el.children || []).forEach(child => inlineStyles(child, view));
      return;
    }

    // Mac 风格代码块圆点容器保持原有样式
    if (el.classList && el.classList.contains('mac-sign')) {
      Array.from(el.children || []).forEach(child => inlineStyles(child, view));
      return;
    }

    // 信息卡片表格与单元格保持原有行内样式
    if (isInfoCardTable(el) || isInfoCardTd(el)) {
      Array.from(el.children || []).forEach(child => inlineStyles(child, view));
      return;
    }

    // 信息卡片内自带行内样式的段落保持原有样式（保留红字标题与紧凑边距）
    if (tag === 'p' && el.getAttribute && el.getAttribute('style') && el.closest && isInfoCardTd(el.closest('td'))) {
      Array.from(el.children || []).forEach(child => inlineStyles(child, view));
      return;
    }

    // 滑动幻灯片 section 容器保持原有行内样式
    if (tag === 'section' && ((el.getAttribute && el.getAttribute('style')) || (el.textContent && el.textContent.includes('左右滑动看更多')))) {
      Array.from(el.children || []).forEach(child => inlineStyles(child, view));
      return;
    }

    // 滑动幻灯片中的说明段落保持原有行内样式
    if (tag === 'p' && ((el.closest && el.closest('section[style*="overflow-x: scroll"]')) || (el.textContent && el.textContent.includes('左右滑动看更多')))) {
      Array.from(el.children || []).forEach(child => inlineStyles(child, view));
      return;
    }

    // 图片元素按上下文设置微信公众号兼容样式
    if (tag === 'img') {
      const isInSlideshow = el.closest && el.closest('section[style*="overflow-x: scroll"]');
      const isInList = el.closest && (el.closest('ul') || el.closest('ol') || el.closest('li'));
      const inInfoCard = el.closest && isInfoCardTd(el.closest('td'));

      if (isInSlideshow) {
        el.setAttribute('style', 'display: block; width: 100%; height: auto; margin: 0.1em auto 0.2em; border: 1px solid rgba(0, 0, 0, 0.04);');
      } else if (inInfoCard) {
        el.setAttribute('style', 'max-width: 100%; height: auto; display: block; margin: 6px 0;');
      } else if (isInList) {
        el.setAttribute('style', 'display: block; max-width: 100%; margin: 0.1em auto 0.5em; border: 1px solid rgba(0, 0, 0, 0.04);');
      } else {
        el.setAttribute('style', 'max-width: 100%; height: auto; display: block; margin: 16px auto;');
      }
      return;
    }

    // 语法高亮 span (.hljs / .hljs-*)：显式内联颜色、粗细、斜体和背景色
    if (tag === 'span' && isHljsElement(el)) {
      const cs = view.getComputedStyle(el);
      let styleStr = '';
      ['color', 'font-weight', 'font-style', 'background-color'].forEach((prop) => {
        const val = cs.getPropertyValue(prop);
        if (!val) return;
        if (prop === 'background-color' && isTransparentOrUiBg(val)) return;
        if (prop === 'font-style' && val === 'normal') return;
        if (prop === 'font-weight' && (val === '400' || val === 'normal')) return;
        styleStr += `${prop}:${val};`;
      });
      if (styleStr) {
        el.setAttribute('style', styleStr);
      }
      Array.from(el.children || []).forEach(child => inlineStyles(child, view));
      return;
    }

    // 引用角标 span (.reference-link)
    if (tag === 'span' && el.classList && el.classList.contains('reference-link')) {
      const cs = view.getComputedStyle(el);
      let styleStr = '';
      ['color', 'vertical-align', 'font-size', 'font-weight', 'padding'].forEach((prop) => {
        const val = cs.getPropertyValue(prop);
        if (val && val !== 'none') {
          styleStr += `${prop}:${val};`;
        }
      });
      if (styleStr) {
        el.setAttribute('style', styleStr);
      }
      Array.from(el.children || []).forEach(child => inlineStyles(child, view));
      return;
    }

    // code 元素：区分代码块内 <pre><code> 与行内 <code>
    if (tag === 'code') {
      const cs = view.getComputedStyle(el);
      const isBlockCode = !!(el.closest && el.closest('pre'));
      const codeProps = isBlockCode
        ? ['font-family', 'font-size', 'line-height', 'color', 'padding', 'display', 'overflow-x', 'white-space', 'word-wrap', 'word-break']
        : ['font-family', 'font-size', 'color', 'background-color', 'padding', 'border-radius'];
      let styleStr = '';
      codeProps.forEach((prop) => {
        const val = cs.getPropertyValue(prop);
        if (!val || val === 'none') return;
        if (prop === 'background-color' && isTransparentOrUiBg(val)) return;
        styleStr += `${prop}:${val};`;
      });
      if (styleStr) {
        el.setAttribute('style', styleStr);
      }
      Array.from(el.children || []).forEach(child => inlineStyles(child, view));
      return;
    }

    // 其余纯内联文本标签不强行注入布局样式，避免公众号异常换行
    const PLAIN_INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'small', 'sup', 'sub', 'span']);
    if (PLAIN_INLINE_TAGS.has(tag)) {
      Array.from(el.children || []).forEach(child => inlineStyles(child, view));
      return;
    }

    const cs = view.getComputedStyle(el);
    let props = [
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'color',
      'text-align',
      'text-decoration',
      'border',
      'border-top',
      'border-left',
      'border-bottom',
      'line-height',
      'margin',
      'padding',
      'border-radius',
      'box-shadow',
      'text-shadow',
      'width',
      'display',
      'position',
      'white-space',
      'word-wrap',
      'word-break',
      'overflow-x'
    ];

    if (tag === 'table') {
      props.push('border-collapse');
    }

    // 仅对明确需要背景色的块元素保留 background-color（h2 不保留背景）
    if (tag === 'blockquote' || tag === 'pre' || tag === 'h1' || tag === 'th') {
      props.push('background-color');
    }

    // 对链接、列表项与段落避免设置会影响换行的布局属性
    if (tag === 'a' || tag === 'li' || tag === 'p') {
      props = props.filter(p => !['width', 'display', 'position', 'white-space'].includes(p));
    }

    let styleStr = '';
    props.forEach((prop) => {
      const val = cs.getPropertyValue(prop);
      if (!val || val === 'none') return;
      if (prop === 'background-color' && isTransparentOrUiBg(val)) return;
      if (prop === 'font-style' && val === 'normal') return;
      if (prop === 'text-decoration' && val.startsWith('none')) return;
      if (isDefaultBorderValue(prop, val)) return;
      styleStr += `${prop}:${val};`;
    });

    if (tag === 'pre') {
      styleStr += 'position:relative;';
    }

    el.setAttribute('style', styleStr);
    Array.from(el.children || []).forEach(child => inlineStyles(child, view));
  }

  // ---- 浏览器应用初始化 ----
  function initBrowserApp() {
    // 显示依赖加载失败提示条（纯 DOM API，不依赖 innerHTML）
    function showLibraryLoadError(message) {
      const appEl = document.querySelector('.app');
      const previewEl = document.getElementById('preview');

      if (appEl && !appEl.querySelector('.load-error-banner')) {
        const banner = document.createElement('div');
        banner.className = 'load-error-banner';
        banner.setAttribute('role', 'alert');

        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        banner.appendChild(textSpan);

        const reloadBtn = document.createElement('button');
        reloadBtn.type = 'button';
        reloadBtn.className = 'load-error-retry';
        reloadBtn.textContent = '刷新重试';
        reloadBtn.addEventListener('click', () => window.location.reload());
        banner.appendChild(reloadBtn);

        const toolbar = appEl.querySelector('.toolbar');
        if (toolbar && toolbar.nextSibling) {
          appEl.insertBefore(banner, toolbar.nextSibling);
        } else {
          appEl.prepend(banner);
        }
      }

      if (previewEl) {
        previewEl.textContent = message;
      }
    }

    waitForLibraries()
      .then(() => {
        if (window.hljs) {
          window.hljs.configure({
            ignoreUnescapedHTML: true
          });
        }
        initializeEditor();
      })
      .catch((err) => {
        console.error(err);
        showLibraryLoadError(err && err.message ? err.message : '依赖库加载失败，请刷新页面重试。');
      });

    function initializeEditor() {
      const converter = new window.showdown.Converter({
        tables: true,
        ghCodeBlocks: true,
        strikethrough: true,
        tasklists: true,
        emoji: true,
        underline: true,
        ghCompatibleHeaderId: true,
        parseImgDimensions: true
      });

      const DEFAULT_MD_CONTENT = `## Paper 编辑器简介

> **Paper** 是一款轻量级微信公众号 Markdown 编辑器。现代化双栏实时编辑布局，实时 Markdown 预览，响应式设计；支持大部分 Markdown 语法 (数学公式和 Mermaid除外,请在发布区进行手工渲染)，支持信息卡片。预览区与微信公众号编辑器等宽，所见即所得。欢迎使用👏！ **定制属于每个人自己的微信公众号样式！**

![](https://pic2.zhimg.com/v2-8b3e679e2d23b3516650c9e451fde283_r.jpg)


### 🎯 核心特性

**1. 现代化实时排版布局**
- 编辑区：支持 Markdown 语法编写
- 预览区：实时渲染，578px 宽度（与微信公众号编辑器等宽）
- 发布区：提供一键复制和相关工具链接

**2. 微信公众号完美适配**
- 预览区严格按照微信公众号标准，预览区与微信公众号编辑器等宽（578px）
- 支持的样式完全兼容微信公众号平台
- 一键复制后可直接粘贴到公众号编辑器
- 针对性设计了二级标题，建议使用二级标题和三级标题

**3. 丰富的功能支持**
- ✅ 基础 Markdown 语法（标题、段落、列表、表格等）
- ✅ 代码语法高亮（Kimbie Light 主题，Mac 风格）
- ✅ 自定义信息卡片（\`:::info\` 语法）
- ✅ 横屏滑动幻灯片（\`<![alt](url),![alt](url)>\` 语法）
- ✅ 同步滚动（编辑器与预览区联动）
- ❌ 数学公式（不支持，请使用工具栏链接手工渲染）
- ❌ Mermaid 图表（不支持，使用工具栏链接手工渲染）


## 快速开始

1. 访问在线版 [paper.thus.chat](https://paper.thus.chat)
2. 下载 \`html\` 单文件到本地直接运行
3. 下载 \`html\` 单文件部署到自己的服务器使用
4. 下载 \`html\` 单文件用 \`AI\` 修改成自己喜欢的样式后食用


## 常见样式

> **引用样式**：Paper 是一款轻量级微信公众号 Markdown 编辑器。现代化实时预览，响应式设计；支持大部分 Markdown 语法 (数学公式和 Mermaid除外)，支持信息卡片。预览区与微信公众号编辑器等宽，所见即所得。欢迎使用👏！

:::orange
**浅橙色卡片：** Paper 是一款轻量级微信公众号 Markdown 编辑器。实时 Markdown 预览，响应式设计；支持大部分 Markdown 语法 (数学公式和 Mermaid除外,请在发布区进行手工渲染)，支持信息卡片。
:::

:::blue
**浅蓝色卡片：**Paper 是一款轻量级微信公众号 Markdown 编辑器。实时 Markdown 预览，响应式设计；支持大部分 Markdown 语法 (数学公式和 Mermaid除外,请在发布区进行手工渲染)，支持信息卡片。

支持换行，支持图片。
:::

:::info 信息卡片
这是一个信息卡片，支持 **粗体** 和 *斜体* 文本，可以包含多个段落和图片。

![picture](https://pic4.zhimg.com/v2-651d25a2a36f7ee0406f2a310b245def_r.jpg)
:::


\`\`\`python
# 这是一个 Python 代码块

def contains_number(s):
    return any(char.isdigit() for char in s)


test_string = "Hello123"
if contains_number(test_string):
    print("字符串包含数字")
else:
    print("字符串不包含数字")
\`\`\`

| 常用网址表格             | 功能                  | 推荐    |
| ------------------------------------------- | ---------------------- | ------------ |
| [Mermaid 渲染](https://mermaid-live.nodejs.cn/edit) | Mermaid图渲染 | 🌟🌟🌟  |
| [数学公式渲染](https://mathjax.thus.chat/)   \t| 数学公式渲染 | 🌟🌟🌟 |
| [Markdown语法速查](https://hub.thus.chat/apps/markdown) | Markdown 语法速查 | 🌟🌟🌟🌟 |

<![PIC01.png](https://picx.zhimg.com/v2-45dd5f524da0d125233d6af4fb2d4135_r.jpg),![PIC02.png](https://pic1.zhimg.com/v2-d591ac49a57ca87cb3c7b29d6e1a7622_r.jpg),![PIC03.png](https://picx.zhimg.com/v2-b712755e8f4e02226582bbfb6246dcd3_r.jpg)>`;

      // DOM 元素引用
      const mdInput = document.getElementById('markdown');
      const preview = document.getElementById('preview');
      const copyBtn = document.getElementById('copyBtn');
      const loadExampleBtn = document.getElementById('loadExampleBtn');
      const confettiCanvas = document.getElementById('confetti-canvas');
      const wordCount = document.getElementById('wordCount');
      const charCount = document.getElementById('charCount');
      const saveStatus = document.getElementById('saveStatus');
      const zoomLevelEl = document.getElementById('zoomLevel');
      const zoomInBtn = document.getElementById('zoomIn');
      const zoomOutBtn = document.getElementById('zoomOut');
      const tbResetBtn = document.getElementById('tbReset');
      const previewContent = document.querySelector('.preview-content');
      const lineNumbersEl = document.querySelector('.line-numbers');

      let myConfetti;
      let autoSaveTimer;
      let typingTimer;
      let isRendering = false;
      let suppressChange = false;

      // localStorage 错误处理工具函数
      function saveToLocalStorage(key, value) {
        try {
          localStorage.setItem(key, value);
          return true;
        } catch (e) {
          console.error('保存失败:', e);
          if (e.name === 'QuotaExceededError') {
            alert('存储空间已满,请清理浏览器缓存');
          }
          return false;
        }
      }

      function loadFromLocalStorage(key, defaultValue = null) {
        try {
          const value = localStorage.getItem(key);
          return value !== null ? value : defaultValue;
        } catch (e) {
          console.error('读取失败:', e);
          return defaultValue;
        }
      }

      function removeFromLocalStorage(key) {
        try {
          localStorage.removeItem(key);
          return true;
        } catch (e) {
          console.error('删除失败:', e);
          return false;
        }
      }

      function manualSave(cm) {
        const content = cm ? cm.getValue() : getEditorValue();
        if (saveToLocalStorage('md_editor_draft', content)) {
          saveToLocalStorage('md_editor_save_time', new Date().toLocaleString());
          saveStatus.textContent = '手动保存成功';
          setTimeout(() => {
            saveStatus.textContent = '已保存';
          }, 2000);
        } else {
          saveStatus.textContent = '保存失败';
        }
      }

      // 初始化 CodeMirror 编辑器（viewportMargin 设为有限值以启用虚拟滚动，支持 Ctrl & Cmd 快捷键）
      const codeMirrorEditor = window.CodeMirror.fromTextArea(mdInput, {
        mode: 'markdown',
        theme: 'github',
        lineNumbers: false,
        lineWrapping: true,
        autofocus: true,
        viewportMargin: 20,
        placeholder: '在此输入 Markdown 内容...\n\n支持实时预览，编辑完成后可一键复制到微信公众号。',
        extraKeys: {
          'Ctrl-S': manualSave,
          'Cmd-S': manualSave,
          'Ctrl-Enter': function () { copyBtn.click(); },
          'Cmd-Enter': function () { copyBtn.click(); },
          'Ctrl-B': function () { toolbarToggleBold(); },
          'Cmd-B': function () { toolbarToggleBold(); },
          'Ctrl-I': function () { toolbarToggleItalic(); },
          'Cmd-I': function () { toolbarToggleItalic(); },
          'Enter': function (cm) {
            const pos = cm.getCursor();
            const line = cm.getLine(pos.line);
            const matchTask = line.match(/^\s*- \[( |x|X)\]\s+/);
            const matchUl = line.match(/^\s*([-*+])\s+/);
            const matchOl = line.match(/^\s*(\d+)\.\s+/);
            if (matchTask || matchUl || matchOl) {
              const markerLen = (matchTask && matchTask[0].length) || (matchUl && matchUl[0].length) || (matchOl && matchOl[0].length) || 0;
              const content = line.slice(markerLen);
              if (content.trim().length === 0) {
                cm.replaceRange('\n', { line: pos.line, ch: line.length }, { line: pos.line, ch: line.length });
                cm.replaceRange('', { line: pos.line, ch: 0 }, { line: pos.line, ch: markerLen });
                return;
              }
              let prefix = '';
              if (matchTask) {
                prefix = matchTask[0].replace('[x]', '[ ]').replace('[X]', '[ ]');
              } else if (matchUl) {
                prefix = matchUl[0];
              } else if (matchOl) {
                const next = parseInt(matchOl[1], 10) + 1;
                prefix = line.replace(/^\s*\d+\.\s+/, `${next}. `).match(/^\s*\d+\.\s+/)[0];
              }
              cm.replaceSelection('\n' + prefix);
              return;
            }
            cm.replaceSelection('\n');
          }
        }
      });

      // 全局快捷键支持（兼容 macOS Cmd 与 Windows/Linux Ctrl）
      document.addEventListener('keydown', (e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        const inEditor = !!(e.target && e.target.closest && e.target.closest('.CodeMirror'));
        if (inEditor) return;

        const key = (e.key || '').toLowerCase();
        if (key === 's') {
          e.preventDefault();
          manualSave(codeMirrorEditor);
        } else if (key === 'enter') {
          e.preventDefault();
          copyBtn.click();
        }
      });

      setTimeout(() => {
        codeMirrorEditor.refresh();
      }, 100);

      let resizeTimer;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          codeMirrorEditor.refresh();
        }, 100);
      });

      function getEditorValue() {
        return codeMirrorEditor.getValue();
      }

      function setEditorValueSilent(value) {
        suppressChange = true;
        try {
          codeMirrorEditor.setValue(value);
        } finally {
          suppressChange = false;
        }
      }

      // 初始化 confetti 实例
      if (window.confetti && typeof window.confetti.create === 'function') {
        myConfetti = window.confetti.create(confettiCanvas, { resize: true, useWorker: true });
      } else if (window.confetti) {
        myConfetti = window.confetti;
      }

      // 统计文本信息
      function updateStats() {
        const text = getEditorValue();
        const characters = text.length;

        let words = 0;
        if (text.trim()) {
          const chineseChars = (text.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g) || []).length;
          const englishText = text.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g, '');
          const englishWords = englishText.trim() ? englishText.trim().split(/\s+/).filter(word => word.length > 0).length : 0;
          words = chineseChars + englishWords;
        }

        wordCount.textContent = `字数: ${words}`;
        charCount.textContent = `字符: ${characters}`;
      }

      // 自动保存功能
      function scheduleAutoSave() {
        saveStatus.textContent = '保存中...';

        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
          if (saveToLocalStorage('md_editor_draft', getEditorValue())) {
            saveToLocalStorage('md_editor_save_time', new Date().toLocaleString());
            saveStatus.textContent = '已保存';
          } else {
            saveStatus.textContent = '保存失败';
          }
        }, CONFIG.AUTO_SAVE_DELAY_MS);
      }

      // 统一渲染管道（Fail-Closed DOMPurify 清洗 + 同步代码高亮）
      function render(options) {
        const opts = options || {};
        clearTimeout(typingTimer);
        isRendering = true;

        try {
          const currentScrollTop = previewContent ? previewContent.scrollTop : 0;
          let markdownText = getEditorValue();

          markdownText = processSlideshow(markdownText);
          markdownText = processInfoCards(markdownText);

          let html = converter.makeHtml(markdownText);
          html = processInfoCardPlaceholders(html, converter);
          html = processReferences(html);

          const renderedSafely = renderSafeHtml(html, preview, window.DOMPurify);
          if (renderedSafely) {
            highlightCodeBlocks(preview, window.hljs, document);
          }

          if (previewContent) {
            previewContent.scrollTop = currentScrollTop;
          }

          updateStats();
          if (!opts.skipAutoSave) {
            scheduleAutoSave();
          }
        } finally {
          isRendering = false;
        }
      }

      // 防抖渲染（140ms 单一渲染管道）
      function scheduleRender() {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
          render();
        }, CONFIG.RENDER_DEBOUNCE_MS);
      }

      // 自定义左侧行号列同步
      function updateLineNumbers() {
        if (!lineNumbersEl) return;
        const lines = codeMirrorEditor.lineCount();
        let content = '';
        for (let i = 1; i <= lines; i++) {
          content += i + '\n';
        }
        lineNumbersEl.textContent = content.slice(0, -1) || '1';
        try {
          const scrollInfo = codeMirrorEditor.getScrollInfo();
          lineNumbersEl.scrollTop = scrollInfo.top;
        } catch (e) { }
      }

      function syncLineNumbersScroll() {
        if (!lineNumbersEl) return;
        try {
          const info = codeMirrorEditor.getScrollInfo();
          lineNumbersEl.scrollTop = info.top;
        } catch (e) { }
      }

      // 仅加载一次初始内容并渲染一次，避免启动期重复渲染
      const savedDraft = loadFromLocalStorage('md_editor_draft');
      if (savedDraft && savedDraft.trim()) {
        setEditorValueSilent(savedDraft);
        const saveTime = loadFromLocalStorage('md_editor_save_time');
        if (saveTime) {
          saveStatus.textContent = '已加载草稿';
        }
      } else {
        setEditorValueSilent(DEFAULT_MD_CONTENT);
      }

      render({ skipAutoSave: true });
      updateLineNumbers();

      // 绑定编辑器变化与滚动事件
      codeMirrorEditor.on('change', () => {
        if (suppressChange) return;
        updateLineNumbers();
        scheduleRender();
      });
      codeMirrorEditor.on('scroll', syncLineNumbersScroll);

      // 复制按钮：离屏挂载 -> 计算并内联样式 -> Clipboard API（降级 execCommand）-> finally 清理
      function setCopyButtonState(copied) {
        copyBtn.textContent = '';
        const icon = document.createElement('i');
        icon.className = copied ? 'fas fa-check' : 'fas fa-copy';
        icon.setAttribute('aria-hidden', 'true');
        copyBtn.appendChild(icon);
        copyBtn.appendChild(document.createTextNode(copied ? ' 已复制！' : ' 复制到公众号'));
      }

      copyBtn.addEventListener('click', async () => {
        const clone = preview.cloneNode(true);
        clone.removeAttribute('id');

        // 将代码块中的空格和制表符转换为不间断空格，同时保留语法高亮 HTML 结构
        const codeElements = clone.querySelectorAll('pre code');
        codeElements.forEach((code) => {
          function processTextNodes(node) {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent;
              if (text.includes(' ') || text.includes('\t')) {
                node.textContent = text
                  .replace(/ /g, '\u00A0')
                  .replace(/\t/g, '\u00A0\u00A0\u00A0\u00A0');
              }
            } else {
              Array.from(node.childNodes).forEach(processTextNodes);
            }
          }
          processTextNodes(code);
        });

        // 在调用 inlineStyles 前将克隆节点挂载到离屏容器，确保 getComputedStyle 正常解析 .typo 与 .hljs 样式
        const offscreenContainer = document.createElement('div');
        offscreenContainer.className = 'app';
        offscreenContainer.setAttribute('aria-hidden', 'true');
        offscreenContainer.style.cssText = `position: fixed; left: -9999px; top: 0; width: ${CONFIG.PREVIEW_WIDTH}px; visibility: hidden; pointer-events: none; z-index: -1;`;

        const offscreenInner = document.createElement('div');
        offscreenInner.className = 'preview-inner';
        offscreenInner.style.cssText = `width: ${CONFIG.PREVIEW_WIDTH}px; padding: 0; margin: 0; transform: none;`;
        offscreenInner.appendChild(clone);
        offscreenContainer.appendChild(offscreenInner);
        document.body.appendChild(offscreenContainer);

        let success = false;
        try {
          inlineStyles(clone, window);

          const rootStyle = clone.getAttribute('style') || '';
          const htmlPayload = rootStyle
            ? `<section style="${escapeHtml(rootStyle)}">${clone.innerHTML}</section>`
            : clone.innerHTML;
          const plainText = clone.innerText || clone.textContent || '';

          if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && typeof window.ClipboardItem === 'function') {
            try {
              const htmlBlob = new Blob([htmlPayload], { type: 'text/html' });
              const textBlob = new Blob([plainText], { type: 'text/plain' });
              await navigator.clipboard.write([
                new window.ClipboardItem({
                  'text/html': htmlBlob,
                  'text/plain': textBlob
                })
              ]);
              success = true;
            } catch (clipboardErr) {
              console.warn('Clipboard API failed, falling back to execCommand:', clipboardErr);
            }
          }

          if (!success) {
            offscreenContainer.style.visibility = 'visible';
            offscreenContainer.style.opacity = '0';

            const range = document.createRange();
            range.selectNodeContents(clone);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            try {
              success = document.execCommand('copy');
            } catch (e) {
              success = false;
            } finally {
              sel.removeAllRanges();
            }
          }
        } finally {
          if (offscreenContainer.parentNode) {
            offscreenContainer.parentNode.removeChild(offscreenContainer);
          }
        }

        if (success) {
          setCopyButtonState(true);
          setTimeout(() => {
            setCopyButtonState(false);
          }, 2000);
          const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (myConfetti && !prefersReducedMotion) {
            myConfetti({
              particleCount: 150,
              spread: 60,
              origin: { y: 0.4 }
            });
          }
        } else {
          alert('复制失败，请手动复制。');
        }
      });

      // 同步滚动功能
      let isEditorScrolling = false;
      let isPreviewScrolling = false;
      let editorScrollTimer;
      let previewScrollTimer;

      function syncScroll(source, target) {
        if (isRendering || !target) return;
        if (source === 'editor' && isPreviewScrolling) return;
        if (source === 'preview' && isEditorScrolling) return;

        let sourceScrollTop, sourceScrollHeight;

        if (source === 'editor') {
          const scrollInfo = codeMirrorEditor.getScrollInfo();
          sourceScrollTop = scrollInfo.top;
          sourceScrollHeight = scrollInfo.height - scrollInfo.clientHeight;
        } else {
          sourceScrollTop = previewContent.scrollTop;
          sourceScrollHeight = previewContent.scrollHeight - previewContent.clientHeight;
        }

        const targetScrollHeight = target.scrollHeight - target.clientHeight;

        if (sourceScrollHeight > 0 && targetScrollHeight > 0) {
          const scrollRatio = sourceScrollTop / sourceScrollHeight;
          target.scrollTop = scrollRatio * targetScrollHeight;
        }
      }

      codeMirrorEditor.on('scroll', () => {
        if (isRendering) return;
        isEditorScrolling = true;
        syncScroll('editor', previewContent);
        clearTimeout(editorScrollTimer);
        editorScrollTimer = setTimeout(() => {
          isEditorScrolling = false;
        }, 100);
      });

      if (previewContent) {
        previewContent.addEventListener('scroll', () => {
          if (isRendering) return;
          isPreviewScrolling = true;
          const scrollInfo = previewContent.scrollTop;
          const scrollHeight = previewContent.scrollHeight - previewContent.clientHeight;
          const editorScrollInfo = codeMirrorEditor.getScrollInfo();
          const editorScrollHeight = editorScrollInfo.height - editorScrollInfo.clientHeight;

          if (scrollHeight > 0 && editorScrollHeight > 0) {
            const scrollRatio = scrollInfo / scrollHeight;
            codeMirrorEditor.scrollTo(null, scrollRatio * editorScrollHeight);
          }

          clearTimeout(previewScrollTimer);
          previewScrollTimer = setTimeout(() => {
            isPreviewScrolling = false;
          }, 100);
        });
      }

      // 预览缩放
      let zoom = 1;
      function applyZoom() {
        const inner = document.querySelector('.preview-inner');
        if (!inner) return;
        inner.style.transform = `scale(${zoom})`;
        if (zoomLevelEl) zoomLevelEl.textContent = `${Math.round(zoom * 100)}%`;
      }
      if (zoomInBtn) zoomInBtn.addEventListener('click', () => { zoom = Math.min(CONFIG.ZOOM_MAX, zoom + CONFIG.ZOOM_STEP); applyZoom(); });
      if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { zoom = Math.max(CONFIG.ZOOM_MIN, zoom - CONFIG.ZOOM_STEP); applyZoom(); });
      applyZoom();

      if (loadExampleBtn) {
        loadExampleBtn.addEventListener('click', () => {
          setEditorValueSilent(DEFAULT_MD_CONTENT);
          updateLineNumbers();
          render();
        });
      }

      // 工具栏交互
      function toolbarToggleBold() {
        const cm = codeMirrorEditor;
        const sel = cm.getSelection();
        const wrapped = sel ? `**${sel}**` : '**粗体**';
        cm.replaceSelection(wrapped, 'around');
        cm.focus();
      }
      function toolbarToggleItalic() {
        const cm = codeMirrorEditor;
        const sel = cm.getSelection();
        const wrapped = sel ? `*${sel}*` : '*斜体*';
        cm.replaceSelection(wrapped, 'around');
        cm.focus();
      }
      function toolbarHeading(level) {
        const cm = codeMirrorEditor;
        const pos = cm.getCursor();
        const line = cm.getLine(pos.line);
        const prefix = '#'.repeat(level) + ' ';
        const newLine = line.replace(/^\s*#{1,6}\s*/, '');
        cm.replaceRange(prefix + newLine, { line: pos.line, ch: 0 }, { line: pos.line, ch: line.length });
        cm.focus();
      }
      function toolbarLink() {
        const cm = codeMirrorEditor;
        const sel = cm.getSelection() || '链接文本';
        const url = prompt('输入链接地址：', 'https://');
        if (!url) return;
        cm.replaceSelection(`[${sel}](${url})`);
        cm.focus();
      }
      function toolbarImage() {
        const alt = prompt('图片说明（可选）：', '');
        const url = prompt('图片地址：', 'https://');
        if (!url) return;
        codeMirrorEditor.replaceSelection(`![${alt || ''}](${url})`);
        codeMirrorEditor.focus();
      }
      function toolbarList(type) {
        const cm = codeMirrorEditor;
        const pos = cm.getCursor();
        const line = cm.getLine(pos.line);
        let marker = '- ';
        if (type === 'ol') {
          marker = '1. ';
        } else if (type === 'task') {
          marker = '- [ ] ';
        }
        if (/^\s*([-*+]|\d+\.|- \[ \])\s+/.test(line)) {
          cm.replaceRange(marker + line.replace(/^\s*([-*+]|\d+\.|- \[ \])\s+/, ''), { line: pos.line, ch: 0 }, { line: pos.line, ch: line.length });
        } else {
          cm.replaceRange(marker + line, { line: pos.line, ch: 0 }, { line: pos.line, ch: line.length });
        }
        cm.focus();
      }
      function toolbarTable() {
        const tpl = `| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容1 | 内容2 | 内容3 |`;
        codeMirrorEditor.replaceSelection('\n' + tpl + '\n');
        codeMirrorEditor.focus();
      }

      const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
      bind('tbBold', toolbarToggleBold);
      bind('tbItalic', toolbarToggleItalic);
      bind('tbH1', () => toolbarHeading(1));
      bind('tbH2', () => toolbarHeading(2));
      bind('tbH3', () => toolbarHeading(3));
      bind('tbLink', toolbarLink);
      bind('tbImage', toolbarImage);
      bind('tbUl', () => toolbarList('ul'));
      bind('tbOl', () => toolbarList('ol'));
      bind('tbTask', () => toolbarList('task'));
      bind('tbTable', toolbarTable);

      bind('toolBold', toolbarToggleBold);
      bind('toolItalic', toolbarToggleItalic);
      bind('toolHeading', () => toolbarHeading(2));
      bind('toolList', () => toolbarList('ul'));
      bind('toolLink', toolbarLink);
      bind('toolImage', toolbarImage);
      bind('toolEmpty', () => codeMirrorEditor.replaceSelection('\n\n'));
      bind('toolClear', () => {
        if (confirm('确认清空当前内容？')) {
          setEditorValueSilent('');
          updateLineNumbers();
          render();
        }
      });

      // 恢复默认内容按钮
      function resetToDefault() {
        if (!confirm('确认恢复默认内容？草稿将被覆盖。')) return;
        setEditorValueSilent(DEFAULT_MD_CONTENT);
        removeFromLocalStorage('md_editor_draft');
        removeFromLocalStorage('md_editor_save_time');
        updateLineNumbers();
        render({ skipAutoSave: true });
        saveStatus.textContent = '已恢复默认内容';
        setTimeout(() => { saveStatus.textContent = '已保存'; }, 2000);
      }
      if (tbResetBtn) tbResetBtn.addEventListener('click', resetToDefault);
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initBrowserApp);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      CONFIG,
      FAIL_CLOSED_MESSAGE,
      escapeHtml,
      decodeBasicHtmlEntities,
      sanitizeUrl,
      safeDecodeURIComponent,
      processReferences,
      processInfoCards,
      processInfoCardPlaceholders,
      processSlideshow,
      renderSafeHtml,
      highlightCodeBlocks,
      waitForLibraries,
      inlineStyles
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
