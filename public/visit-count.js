(() => {
  const output = document.querySelector('#visitCount');
  if (!output) return;
  fetch('/api/analytics/summary', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    .then(async response => {
      if (!response.ok) throw new Error('Statistics unavailable');
      const stats = await response.json();
      output.textContent = '累计访问 ' + Number(stats.totalVisits).toLocaleString('zh-CN') +
        ' · 今日 ' + Number(stats.todayVisits).toLocaleString('zh-CN');
    })
    .catch(() => { output.textContent = '访问统计暂不可用'; });
})();
