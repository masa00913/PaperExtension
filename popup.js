document.addEventListener('DOMContentLoaded', () => {
    const notionApiKeyInput = document.getElementById('notionApiKey');
    const notionDbIdInput = document.getElementById('notionDbId');
    const geminiApiKeyInput = document.getElementById('geminiApiKey');
    const saveSettingsButton = document.getElementById('saveSettings');
    const saveToNotionButton = document.getElementById('saveToNotion');
    const statusDiv = document.getElementById('status');
  
    // 設定を読み込む
    chrome.storage.sync.get(['notionApiKey', 'notionDbId', 'geminiApiKey'], (result) => {
      if (result.notionApiKey) notionApiKeyInput.value = result.notionApiKey;
      if (result.notionDbId) notionDbIdInput.value = result.notionDbId;
      if (result.geminiApiKey) geminiApiKeyInput.value = result.geminiApiKey;
    });
  
    // 設定を保存する
    saveSettingsButton.addEventListener('click', () => {
      const notionApiKey = notionApiKeyInput.value;
      const notionDbId = notionDbIdInput.value;
      const geminiApiKey = geminiApiKeyInput.value;
      chrome.storage.sync.set({ notionApiKey, notionDbId, geminiApiKey }, () => {
        statusDiv.textContent = '設定を保存しました。';
        setTimeout(() => statusDiv.textContent = '', 2000);
      });
    });
  
    // Notionに保存する処理をバックグラウンドに依頼
    saveToNotionButton.addEventListener('click', async () => {
      statusDiv.textContent = '処理中...';
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          chrome.runtime.sendMessage({
            action: "savePageToNotion",
            tabId: tab.id,
            url: tab.url,
            title: tab.title
          }, (response) => {
            if (chrome.runtime.lastError) {
              statusDiv.textContent = `エラー: ${chrome.runtime.lastError.message}`;
              console.error(chrome.runtime.lastError.message);
              return;
            }
            if (response && response.success) {
              statusDiv.textContent = 'Notionへの保存と要約生成が完了しました！';
            } else {
              statusDiv.textContent = `エラー: ${response.error || '不明なエラーが発生しました。'}`;
            }
            setTimeout(() => statusDiv.textContent = '', 5000);
          });
        } else {
          statusDiv.textContent = 'アクティブなタブが見つかりません。';
        }
      } catch (error) {
        statusDiv.textContent = `エラー: ${error.message}`;
        console.error(error);
      }
    });
  });