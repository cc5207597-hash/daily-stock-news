// ── Pipeline: 四赛道 A 股公司词典(名称→ticker)────────────
// 关键词路径据此从新闻标题/描述中抽取受影响公司,填充
// affected_companies 与 tickers(AI 路径的 affected_companies 由模型抽取)。

export const COMPANY_GLOSSARY = [
  // 半导体
  { name: '中芯国际', ticker: '688981', sector: '半导体' },
  { name: '北方华创', ticker: '002371', sector: '半导体' },
  { name: '中微公司', ticker: '688012', sector: '半导体' },
  { name: '韦尔股份', ticker: '603501', sector: '半导体' },
  { name: '紫光国微', ticker: '002049', sector: '半导体' },
  { name: '兆易创新', ticker: '603986', sector: '半导体' },
  { name: '海光信息', ticker: '688041', sector: '半导体' },
  { name: '寒武纪', ticker: '688256', sector: '半导体' },
  { name: '华虹公司', ticker: '688347', sector: '半导体' },
  { name: '长电科技', ticker: '600584', sector: '半导体' },
  { name: '通富微电', ticker: '002156', sector: '半导体' },
  { name: '澜起科技', ticker: '688008', sector: '半导体' },
  // 光模块
  { name: '中际旭创', ticker: '300308', sector: '光模块' },
  { name: '新易盛', ticker: '300502', sector: '光模块' },
  { name: '天孚通信', ticker: '300394', sector: '光模块' },
  { name: '光迅科技', ticker: '002281', sector: '光模块' },
  { name: '剑桥科技', ticker: '603083', sector: '光模块' },
  { name: '华工科技', ticker: '000988', sector: '光模块' },
  { name: '太辰光', ticker: '300570', sector: '光模块' },
  // 创新药
  { name: '百济神州', ticker: '688235', sector: '创新药' },
  { name: '药明康德', ticker: '603259', sector: '创新药' },
  { name: '恒瑞医药', ticker: '600276', sector: '创新药' },
  { name: '信达生物', ticker: '01801.HK', sector: '创新药' },
  { name: '科伦药业', ticker: '002422', sector: '创新药' },
  { name: '复星医药', ticker: '600196', sector: '创新药' },
  { name: '君实生物', ticker: '688180', sector: '创新药' },
  { name: '康方生物', ticker: '09926.HK', sector: '创新药' },
  { name: '百利天恒', ticker: '688506', sector: '创新药' },
  // 黄金
  { name: '紫金矿业', ticker: '601899', sector: '黄金' },
  { name: '山东黄金', ticker: '600547', sector: '黄金' },
  { name: '中金黄金', ticker: '600489', sector: '黄金' },
  { name: '赤峰黄金', ticker: '600988', sector: '黄金' },
  { name: '山金国际', ticker: '000975', sector: '黄金' },
  { name: '湖南黄金', ticker: '002155', sector: '黄金' },
  { name: '招金矿业', ticker: '01818.HK', sector: '黄金' },
];

// 扫描文本,返回该板块命中的公司(去重,保持出现顺序)。sector 缺省时全表扫描。
export function extractCompanies(text, sector = '') {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const c of COMPANY_GLOSSARY) {
    if (sector && c.sector !== sector) continue;
    if (text.includes(c.name) && !seen.has(c.name)) {
      seen.add(c.name);
      out.push(c);
    }
  }
  return out;
}
