// sidepanel.js
import { CriticPrompt } from './prompts.js';
import { OpenAiApiClient } from './api_client.js';

let currentTabId = null;
let isAnalyzing = false;
let currentRawContent = null;
let currentRawResponse = null;

// ============================================
// Utility Functions
// ============================================

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isValidWebPage(tab) {
  return tab?.url?.startsWith('http');
}

function getUrlKey(url) {
  try {
    return url.replace(/\/$/, '').split('#')[0];
  } catch (e) {
    return url;
  }
}

function fixMarkdownTables(text) {
  if (!text) return '';
  return text
    .replace(/\|\n\|/g, '|\n|')
    .replace(/\n\s*\n\s*\|/g, '\n|')
    .replace(/\|\s*\n\s*\n/g, '|\n');
}

function computeTokenInfo(content) {
  const charCount = content.length;
  const wordCount = content.trim().split(/\s+/).length;
  const estimatedTokens = Math.ceil(charCount / 4);
  return {
    charCount,
    wordCount,
    estimatedTokens,
    displayText: `≈ ${estimatedTokens.toLocaleString()} tokens (${wordCount.toLocaleString()} words, ${charCount.toLocaleString()} chars)`
  };
}

// ============================================
// Storage Functions
// ============================================

function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value;
  chrome.storage.local.set({ apiKey });
}

function saveLanguage() {
  const language = document.getElementById('language').value;
  chrome.storage.local.set({ language });
}

async function storeAnalysisResults(urlKey, data) {
  const { tabResults = {} } = await chrome.storage.local.get('tabResults');
  tabResults[urlKey] = {
    ...data,
    timestamp: Date.now(),
    isAnalyzing: false
  };
  await chrome.storage.local.set({ tabResults });
}

async function updateAnalyzingState(urlKey, analyzing, tabId) {
  const { tabResults = {} } = await chrome.storage.local.get('tabResults');
  tabResults[urlKey] = {
    ...tabResults[urlKey],
    isAnalyzing: analyzing,
    timestamp: Date.now(),
    tabId
  };
  await chrome.storage.local.set({ tabResults });
}

async function cleanupOldTabResults() {
  try {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const { tabResults = {} } = await chrome.storage.local.get('tabResults');
    const cleanedResults = {};

    Object.entries(tabResults).forEach(([urlKey, data]) => {
      if (data.timestamp && (now - data.timestamp) < ONE_WEEK_MS) {
        cleanedResults[urlKey] = data;
      }
    });

    await chrome.storage.local.set({ tabResults: cleanedResults });
  } catch (error) {
    // Silently fail
  }
}

// ============================================
// Content Filtering
// ============================================

function filterHighlights(content) {
  if (!content) return '';

  const highlightPatterns = [
    /^(?:ASSUMPTION|FALLACY|CONTRADICTION|INCONSISTENCY|FLUFF):\s*[^\n]*(?:\n(?!\n)[^\n]*)*/gim
  ];

  let cleanContent = content;

  highlightPatterns.forEach((pattern) => {
    cleanContent = cleanContent.replace(pattern, '');
  });

  return cleanContent
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}

// ============================================
// UI State Management
// ============================================

function setLoadingState(loading) {
  const resultDiv = document.getElementById('result');
  const analyzeBtn = document.getElementById('analyzeBtn');

  if (loading) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';
    resultDiv.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <div>Analyzing content...</div>
      </div>`;
  } else {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze';
  }
}

async function syncUIWithTabState(urlKey) {
  const { tabResults = {} } = await chrome.storage.local.get('tabResults');
  const tabData = tabResults[urlKey];
  setLoadingState(tabData?.isAnalyzing || false);
}

function displayResult(text, title = '') {
  const resultDiv = document.getElementById('result');
  if (!resultDiv) return;

  try {
    let displayText;

    if (typeof text === 'string') {
      displayText = fixMarkdownTables(text);
    } else if (text && typeof text === 'object') {
      const summary = text.summary || text.analysis?.summary || '';
      const critique = text.critique || text.analysis?.critique || '';
      displayText = `${fixMarkdownTables(summary)}\n\n${fixMarkdownTables(critique)}`;
    } else {
      displayText = 'Invalid analysis format';
    }

    const htmlContent = simpleMarkdown(displayText);
    const titleHtml = title ? `<div class="article-title">Analyzing: ${title}</div>` : '';

    resultDiv.innerHTML = `
      <div class="result">
        ${titleHtml}
        <div class="markdown-content">${htmlContent}</div>
      </div>`;
    resultDiv.scrollTop = 0;
  } catch (error) {
    const titleHtml = title ? `<div class="article-title">Analyzing: ${title}</div>` : '';
    resultDiv.innerHTML = `
      <div class="result">
        ${titleHtml}
        <div class="markdown-content">${typeof text === 'string' ? text : JSON.stringify(text, null, 2)}</div>
      </div>`;
  }
}

function displayError(error) {
  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = `<div class="result error">${error}</div>`;
}

function updateApiKeyStatus(apiKey) {
  const statusElement = document.getElementById('apiKeyStatus');

  if (apiKey) {
    const isValid = apiKey.startsWith('sk-');
    statusElement.textContent = isValid ? 'Configured' : 'Invalid format';
    statusElement.className = `api-key-status ${isValid ? 'valid' : ''}`;
  } else {
    statusElement.textContent = 'Not configured';
    statusElement.className = 'api-key-status';
  }
}

// ============================================
// Modal Management
// ============================================

function showModal(modalElement) {
  modalElement?.classList.add('visible');
}

function hideModal(modalElement) {
  modalElement?.classList.remove('visible');
}

// ============================================
// API Functions
// ============================================

async function makeApiCall(promptInstance, content, options = {}) {
  const apiKey = options.apiKey;
  if (!apiKey) {
    throw new Error('No API key found');
  }

  const client = new OpenAiApiClient({
    apiKey,
    model: promptInstance.model
  });

  const formattedPrompt = promptInstance.formatWithContent(content);
  const jsonSchema = promptInstance.getJsonSchema?.();

  const rawResponse = await client.call(formattedPrompt, {
    ...options,
    jsonSchema
  });

  const parsedResponse = promptInstance.parseResponse(rawResponse);
  return { raw: rawResponse, parsed: parsedResponse };
}

// ============================================
// Analysis Functions
// ============================================

async function executeAnalysis(contentToAnalyze, tabInfo, apiKey) {
  const urlKey = getUrlKey(tabInfo.url);
  currentTabId = tabInfo.id;
  isAnalyzing = true;

  setLoadingState(true);
  await updateAnalyzingState(urlKey, true, tabInfo.id);

  try {
    currentRawContent = contentToAnalyze;

    const tokenInfo = computeTokenInfo(contentToAnalyze);
    document.getElementById('rawContentTokenInfo').textContent = tokenInfo.displayText;

    const { language = 'ENGLISH' } = await chrome.storage.local.get('language');
    const promptInstance = new CriticPrompt({ language });

    const { raw, parsed } = await makeApiCall(promptInstance, contentToAnalyze, { apiKey });
    currentRawResponse = raw;

    const storedData = {
      content: contentToAnalyze,
      title: tabInfo.title,
      url: tabInfo.url,
      tabId: tabInfo.id,
      analysis: parsed.analysis,
      highlights: parsed.highlights
    };

    if (parsed.highlights?.length > 0) {
      chrome.tabs.sendMessage(tabInfo.id, {
        action: "highlightContent",
        highlights: parsed.highlights
      });
    }

    await storeAnalysisResults(urlKey, storedData);

    const activeTab = await getActiveTab();
    if (activeTab?.id === tabInfo.id) {
      displayResult(parsed.analysis, tabInfo.title);
    }

  } catch (error) {
    await updateAnalyzingState(urlKey, false, tabInfo.id);
    const activeTab = await getActiveTab();
    if (activeTab?.id === tabInfo.id) {
      displayError('Error: ' + error.message);
    }
  } finally {
    const activeTab = await getActiveTab();
    if (activeTab?.id === tabInfo.id) {
      isAnalyzing = false;
      setLoadingState(false);
    }
  }
}

async function analyzeContent() {
  const { apiKey: storedApiKey } = await chrome.storage.local.get(['apiKey']);
  const inputApiKey = document.getElementById('apiKey').value;
  const apiKey = storedApiKey || inputApiKey;

  if (!apiKey) {
    displayError('Please enter your API key');
    return;
  }

  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    displayError('Unable to find active tab or tab URL');
    return;
  }

  if (inputApiKey && inputApiKey !== storedApiKey) {
    saveApiKey();
  }

  setLoadingState(true);
  const urlKey = getUrlKey(tab.url);
  await updateAnalyzingState(urlKey, true, tab.id);

  try {
    let contentToAnalyze;

    if (currentRawContent) {
      contentToAnalyze = currentRawContent;
    } else {
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Unable to get page content'));
        }, 5000);

        chrome.tabs.sendMessage(tab.id, { action: "getContent" }, (msgResponse) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error('Content script not ready. Please refresh the page.'));
            return;
          }
          resolve(msgResponse);
        });
      });

      if (!response || !response.content) {
        throw new Error('Unable to get page content');
      }

      contentToAnalyze = filterHighlights(response.content);
    }

    await executeAnalysis(contentToAnalyze, {
      id: tab.id,
      url: tab.url,
      title: tab.title
    }, apiKey);

  } catch (error) {
    await updateAnalyzingState(getUrlKey(tab.url), false, tab.id);
    displayError('Error: ' + error.message);
    setLoadingState(false);
    isAnalyzing = false;
  }
}

async function loadStoredAnalysis(tabId) {
  if (!tabId) return;

  try {
    const tab = await chrome.tabs.get(tabId);

    if (!tab || !tab.url) {
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);
      return;
    }

    const urlKey = getUrlKey(tab.url);
    const storage = await chrome.storage.local.get('tabResults');

    if (!storage?.tabResults) {
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);
      return;
    }

    const tabData = storage.tabResults[urlKey];
    await syncUIWithTabState(urlKey);

    if (tabData) {
      displayResult(tabData.analysis, tabData.title);

      if (tabData.content) {
        currentRawContent = filterHighlights(tabData.content);
        document.getElementById('rawContentTokenInfo').textContent =
          computeTokenInfo(currentRawContent).displayText;
      }

      if (tabData.highlights?.length > 0) {
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: "highlightContent",
            highlights: tabData.highlights
          });
        } catch (error) {
          // Silently fail if content script not ready
        }
      }
    } else {
      document.getElementById('result').innerHTML = '';
      currentRawContent = null;
      currentRawResponse = null;
    }
  } catch (error) {
    document.getElementById('result').innerHTML = '';
    currentRawContent = null;
    currentRawResponse = null;
    setLoadingState(false);
  }
}

// ============================================
// Event Listeners Setup
// ============================================

function setupHeaderButtons() {
  const headerButtonsContainer = document.createElement('div');
  headerButtonsContainer.className = 'header-buttons-container';
  headerButtonsContainer.innerHTML = `
    <button id="apiKeyBtn" class="header-button icon-only" title="API Settings">
      <span class="button-icon">⚙️</span>
    </button>
    <button id="rawContentBtn" class="header-button icon-only" title="Raw Content">
      <span class="button-icon">📄</span>
    </button>
    <button id="rawResponseBtn" class="header-button icon-only" title="Raw Response">
      <span class="button-icon">📋</span>
    </button>
    <button id="analyzeBtn" class="header-button primary" title="Analyze Content">
      <span class="button-text">Analyze</span>
    </button>
  `;

  const headerRight = document.querySelector('.header-right');
  headerRight.querySelectorAll('.header-button').forEach(btn => btn.remove());
  headerRight.appendChild(headerButtonsContainer);
}

function setupModalListeners(apiKeyModal, rawContentModal, rawResponseModal) {
  // API Key Modal
  document.getElementById('apiKeyBtn').addEventListener('click', () => {
    showModal(apiKeyModal);
    chrome.storage.local.get(['apiKey', 'language'], (result) => {
      if (result.apiKey) {
        document.getElementById('apiKey').value = result.apiKey;
        updateApiKeyStatus(result.apiKey);
      }
      if (result.language) {
        document.getElementById('language').value = result.language;
      }
    });
  });

  document.getElementById('closeApiKeyBtn').addEventListener('click', () => hideModal(apiKeyModal));

  document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
    saveApiKey();
    saveLanguage();
    hideModal(apiKeyModal);
  });

  document.getElementById('apiKey').addEventListener('input', (e) => {
    updateApiKeyStatus(e.target.value);
  });

  // Raw Content Modal
  document.getElementById('rawContentBtn').addEventListener('click', () => {
    const textDiv = document.getElementById('rawContentText');

    if (currentRawContent) {
      document.getElementById('rawContentTokenInfo').textContent =
        computeTokenInfo(currentRawContent).displayText;
      textDiv.textContent = currentRawContent;
      document.getElementById('copyContentBtn').style.display = 'block';
    } else {
      textDiv.textContent = 'No content available';
      document.getElementById('copyContentBtn').style.display = 'none';
    }
    showModal(rawContentModal);
  });

  document.getElementById('closeRawContentBtn').addEventListener('click', () => hideModal(rawContentModal));

  document.getElementById('copyContentBtn').addEventListener('click', async () => {
    if (currentRawContent) {
      try {
        await navigator.clipboard.writeText(currentRawContent);
        const copyBtn = document.getElementById('copyContentBtn');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        // Silently fail
      }
    }
  });

  // Raw Response Modal
  document.getElementById('rawResponseBtn').addEventListener('click', () => {
    const textDiv = document.getElementById('rawResponseText');

    if (currentRawResponse) {
      try {
        const jsonResponse = JSON.parse(currentRawResponse);
        textDiv.textContent = JSON.stringify(jsonResponse, null, 2);
      } catch (e) {
        textDiv.textContent = currentRawResponse;
      }
      document.getElementById('rawResponseTokenInfo').textContent =
        computeTokenInfo(currentRawResponse).displayText;
    } else {
      textDiv.textContent = 'No raw response available. Please run an analysis first.';
    }
    showModal(rawResponseModal);
  });

  document.getElementById('closeRawResponseBtn').addEventListener('click', () => hideModal(rawResponseModal));

  // Click outside to close modals
  window.addEventListener('click', (e) => {
    if (e.target === apiKeyModal) hideModal(apiKeyModal);
    if (e.target === rawContentModal) hideModal(rawContentModal);
    if (e.target === rawResponseModal) hideModal(rawResponseModal);
  });
}

function setupTabListeners() {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      currentTabId = activeInfo.tabId;
      const tab = await chrome.tabs.get(activeInfo.tabId);

      if (!isValidWebPage(tab)) {
        document.getElementById('result').innerHTML = '';
        setLoadingState(false);
        return;
      }

      const urlKey = getUrlKey(tab.url);
      await syncUIWithTabState(urlKey);

      document.getElementById('result').innerHTML = '';
      await loadStoredAnalysis(activeInfo.tabId);
    } catch (error) {
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tabId === currentTabId && changeInfo.status === 'complete') {
      try {
        if (!isValidWebPage(tab)) {
          document.getElementById('result').innerHTML = '';
          setLoadingState(false);
          return;
        }

        const urlKey = getUrlKey(tab.url);
        await syncUIWithTabState(urlKey);

        document.getElementById('result').innerHTML = '';
        await loadStoredAnalysis(tabId);
      } catch (error) {
        document.getElementById('result').innerHTML = '';
        setLoadingState(false);
      }
    }
  });
}

// ============================================
// Initialization
// ============================================

async function initializeExtension() {
  if (window.extensionInitialized) return;
  window.extensionInitialized = true;

  try {
    await cleanupOldTabResults();

    const { apiKey, language } = await chrome.storage.local.get(['apiKey', 'language']);
    if (apiKey) {
      document.getElementById('apiKey').value = apiKey;
      updateApiKeyStatus(apiKey);
    }
    if (language) {
      document.getElementById('language').value = language;
    }

    const tab = await getActiveTab();
    if (tab) {
      currentTabId = tab.id;
      if (isValidWebPage(tab)) {
        await loadStoredAnalysis(tab.id);
      }
    }
  } catch (error) {
    // Silently fail
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initializeExtension();

  const apiKeyModal = document.getElementById('apiKeyModal');
  const rawContentModal = document.getElementById('rawContentModal');
  const rawResponseModal = document.getElementById('rawResponseModal');

  setupHeaderButtons();
  setupModalListeners(apiKeyModal, rawContentModal, rawResponseModal);
  setupTabListeners();

  document.getElementById('analyzeBtn').addEventListener('click', analyzeContent);
});

// Request content from active tab on load
(async () => {
  try {
    const tab = await getActiveTab();
    if (tab && isValidWebPage(tab)) {
      currentTabId = tab.id;
      await loadStoredAnalysis(tab.id);
    }
  } catch (error) {
    // Silently fail
  }
})();
