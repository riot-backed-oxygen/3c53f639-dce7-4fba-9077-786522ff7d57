'use strict';

// Attach to existing text so names, search terms, and image captions stay intact.
function addTranslationControl(element) {
  if (!element || element.dataset.translationReady || !element.textContent.trim()) return;
  element.dataset.translationReady = 'true';
  const original = element.textContent, originalLang = element.getAttribute('lang');
  const controls = document.createElement('div');
  controls.className = 'translation-tools';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'translate-btn';
  button.textContent = '翻译成中文';
  button.setAttribute('aria-pressed', 'false');
  button.title = '将这段文字发送至翻译服务，翻译成中文';
  const status = document.createElement('span');
  status.className = 'translation-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  controls.append(button, status);
  element.after(controls);
  let translated = '', provider = '', showingTranslation = false;

  button.addEventListener('click', async event => {
    event.stopPropagation();
    if (button.disabled) return;
    if (showingTranslation) {
      element.textContent = original;
      if (originalLang === null) element.removeAttribute('lang');
      else element.setAttribute('lang', originalLang);
      showingTranslation = false;
      button.textContent = '显示译文';
      button.setAttribute('aria-pressed', 'false');
      status.textContent = '';
      return;
    }
    button.disabled = true;
    button.textContent = '翻译中…';
    element.setAttribute('aria-busy', 'true');
    status.textContent = '';
    status.classList.remove('translation-error');
    try {
      if (!translated) {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: original }),
          signal: AbortSignal.timeout(50000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '翻译暂时不可用，请重试。');
        if (typeof result.translatedText !== 'string' || !result.translatedText.trim()) throw new Error('未收到译文，请重试。');
        translated = result.translatedText;
        provider = ['DeepL', 'MyMemory'].includes(result.provider) ? result.provider : '';
      }
      if (!element.isConnected) return;
      element.textContent = translated;
      element.setAttribute('lang', 'zh-CN');
      showingTranslation = true;
      button.textContent = '查看原文';
      button.setAttribute('aria-pressed', 'true');
      status.textContent = provider ? provider + ' · 机器翻译' : '机器翻译';
    } catch (error) {
      if (!element.isConnected) return;
      button.textContent = '重试翻译';
      status.classList.add('translation-error');
      status.textContent = error.name === 'TimeoutError' ? '翻译超时，请重试。' :
        error instanceof TypeError ? '无法连接翻译服务，请检查网络。' : error.message;
    } finally {
      button.disabled = false;
      element.removeAttribute('aria-busy');
    }
  });
}
