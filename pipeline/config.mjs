// ── Pipeline: 配置 & 常量 ──────────────────────────────

// GitHub Actions sets CI=true. Local runs (manual build / preview) don't.
// On CI we talk directly to Anthropic; locally we go through the local proxy
// because api.anthropic.com is not reachable from mainland China.
const IS_CI = process.env.CI === 'true';

export const CONFIG = {
  isCi: IS_CI,

  // Local: proxy at 127.0.0.1:15721 (ANTHROPIC_API_KEY is the placeholder the proxy accepts)
  // CI: real key from GitHub Actions secrets, direct to api.anthropic.com
  apiKey: IS_CI ? (process.env.ANTHROPIC_API_KEY || '') : 'PROXY_MANAGED',
  apiBase: IS_CI ? 'https://api.anthropic.com' : 'http://127.0.0.1:15721',
  model: IS_CI ? (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514') : 'claude-sonnet-4-20250514',

  // Google News RSS feeds (blocked in mainland China, kept as fallback)
  feeds: [
    { url: 'https://news.google.com/rss/search?q=semiconductor+chip+Nvidia+TSMC+Intel+AMD+HBM+foundry&hl=en-US&gl=US&ceid=US:en', name: '半导体' },
    { url: 'https://news.google.com/rss/search?q=optical+transceiver+800G+1.6T+silicon+photonics+CPO+LPO+data+center+interconnect&hl=en-US&gl=US&ceid=US:en', name: '光模块' },
    { url: 'https://news.google.com/rss/search?q=innovative+drug+biotech+pharma+FDA+approval+clinical+trial+oncology+gene+therapy&hl=en-US&gl=US&ceid=US:en', name: '创新药' },
    { url: 'https://news.google.com/rss/search?q=gold+price+COMEX+gold+ETF+gold+futures+central+bank+gold+reserve&hl=en-US&gl=US&ceid=US:en', name: '黄金' },
    { url: 'https://news.google.com/rss/search?q=%E5%8D%8A%E5%AF%BC%E4%BD%93+%E8%8A%AF%E7%89%87+%E5%85%89%E6%A8%A1%E5%9D%97+%E5%88%9B%E6%96%B0%E8%8D%AF+%E9%BB%84%E9%87%91&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '中文-四板块' },
    { url: 'https://news.google.com/rss/search?q=China+semiconductor+chip+sanction+export+control+光刻+EDA&hl=en-US&gl=US&ceid=US:en', name: '中国芯片' },
    { url: 'https://news.google.com/rss/search?q=创新药+生物医药+临床试验+FDA+审批+药明康德+百济神州+恒瑞医药&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '中文-创新药' },
    { url: 'https://news.google.com/rss/search?q=黄金+金价+COMEX+黄金ETF+央行购金+美联储+利率&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '中文-黄金' },
  ],
  extraFeeds: [
    { url: 'https://news.google.com/rss/search?q=KOSPI+KOSDAQ+Samsung+SK+hynix+Korean+semiconductor+KRX&hl=en-US&gl=US&ceid=US:en', name: '韩国半导体' },
    { url: 'https://news.google.com/rss/search?q=NASDAQ+SOX+semiconductor+index+Nvidia+AMD+Broadcom+Qualcomm+US+stock&hl=en-US&gl=US&ceid=US:en', name: '美股半导体' },
    { url: 'https://news.google.com/rss/search?q=삼성전자+SK하이닉스+반도체+한국+증시&hl=ko-KR&gl=KR&ceid=KR:ko', name: '한국-반도체' },
    { url: 'https://news.google.com/rss/search?q=中际旭创+新易盛+天孚通信+光模块+制裁+出口管制+业绩+订单&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '光模块龙头' },
    { url: 'https://news.google.com/rss/search?q=中芯国际+北方华创+中微公司+海光信息+寒武纪+先进制程+设备+制裁+产能&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '半导体龙头' },
    { url: 'https://news.google.com/rss/search?q=药明康德+百济神州+恒瑞医药+信达生物+康龙化成+创新药+临床+审批+授权+出海&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '创新药龙头' },
    { url: 'https://news.google.com/rss/search?q=紫金矿业+山东黄金+中金黄金+赤峰黄金+银泰黄金+黄金股+A股&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '黄金龙头' },
    { url: 'https://news.google.com/rss/search?q=Zhongji+Innolight+Eoptolink+Tianfu+optical+sanction+export+ban+BIS+entity+list&hl=en-US&gl=US&ceid=US:en', name: 'Optical-US' },
    { url: 'https://news.google.com/rss/search?q=光模块+800G+1.6T+订单+出货+业绩+关税+贸易战&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '光模块业绩' },
    { url: 'https://news.google.com/rss/search?q=semiconductor+chip+AI+Nvidia+TSMC+foundry&hl=en-US&gl=US&ceid=US:en&sites=reuters', name: 'Reuters-半导体' },
    { url: 'https://news.google.com/rss/search?q=biotech+pharma+drug+FDA+clinical+trial+approval+innovation&hl=en-US&gl=US&ceid=US:en&sites=reuters', name: 'Reuters-创新药' },
    { url: 'https://news.google.com/rss/search?q=gold+price+COMEX+ETF+central+bank+reserve+precious+metal&hl=en-US&gl=US&ceid=US:en&sites=reuters', name: 'Reuters-黄金' },
    { url: 'https://news.google.com/rss/search?q=China+chip+sanction+export+control+technology+restriction&hl=en-US&gl=US&ceid=US:en&sites=reuters', name: 'Reuters-中国芯片' },
    { url: 'https://news.google.com/rss/search?q=semiconductor+chip+technology+stock+market&hl=en-US&gl=US&ceid=US:en&sites=bloomberg', name: 'Bloomberg-科技' },
    { url: 'https://news.google.com/rss/search?q=gold+price+forecast+COMEX+precious+metal+outlook&hl=en-US&gl=US&ceid=US:en&sites=bloomberg', name: 'Bloomberg-黄金' },
    { url: 'https://news.google.com/rss/search?q=biotech+pharma+FDA+drug+approval+M&A&hl=en-US&gl=US&ceid=US:en&sites=bloomberg', name: 'Bloomberg-创新药' },
    { url: 'https://news.google.com/rss/search?q=semiconductor+Nvidia+AMD+chip+stock+investing&hl=en-US&gl=US&ceid=US:en&sites=cnbc', name: 'CNBC-科技投资' },
    { url: 'https://news.google.com/rss/search?q=gold+price+investing+precious+metal+market&hl=en-US&gl=US&ceid=US:en&sites=cnbc', name: 'CNBC-黄金' },
    { url: 'https://news.google.com/rss/search?q=半导体+芯片+光模块+创新药+黄金&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=cls', name: '财联社-四板块' },
    { url: 'https://news.google.com/rss/search?q=药明康德+百济神州+恒瑞医药+创新药+临床+审批&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=cls', name: '财联社-创新药' },
    { url: 'https://news.google.com/rss/search?q=黄金+金价+美联储+利率+央行购金&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=cls', name: '财联社-黄金' },
    { url: 'https://news.google.com/rss/search?q=制裁+出口管制+芯片+科技+限制&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=cls', name: '财联社-制裁政策' },
    { url: 'https://news.google.com/rss/search?q=半导体+芯片+光模块+创新药+黄金&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=jin10', name: '金十数据-四板块' },
    { url: 'https://news.google.com/rss/search?q=黄金+金价+美联储+利率+非农+CPI&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=jin10', name: '金十数据-宏观' },
    { url: 'https://news.google.com/rss/search?q=半导体+芯片+创新药+黄金+A股&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=sina', name: '新浪财经-四板块' },
    { url: 'https://news.google.com/rss/search?q=半导体+芯片+科技股+光模块+算力&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=sina', name: '新浪财经-科技' },
    { url: 'https://news.google.com/rss/search?q=半导体+芯片+光模块+创新药+黄金&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=wallstreetcn', name: '华尔街见闻-四板块' },
    { url: 'https://news.google.com/rss/search?q=美联储+利率+黄金+芯片+制裁+科技战&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=wallstreetcn', name: '华尔街见闻-宏观' },
    { url: 'https://news.google.com/rss/search?q=semiconductor+chip+technology&hl=en-US&gl=US&ceid=US:en&sites=wsj', name: 'WSJ-科技' },
    { url: 'https://news.google.com/rss/search?q=gold+market+price+outlook+Fed+rate&hl=en-US&gl=US&ceid=US:en&sites=wsj', name: 'WSJ-黄金' },
    { url: 'https://news.google.com/rss/search?q=China+semiconductor+chip+sanction+export&hl=en-US&gl=US&ceid=US:en&sites=ft', name: 'FT-中国芯片' },
    { url: 'https://news.google.com/rss/search?q=半导体+芯片+创新药+黄金+投资&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=21jingji', name: '21世纪经济' },
    { url: 'https://news.google.com/rss/search?q=创新药+生物医药+黄金+科技股&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=eeo', name: '经济观察报' },
    { url: 'https://news.google.com/rss/search?q=半导体+创新药+黄金+资产配置&hl=zh-CN&gl=CN&ceid=CN:zh-Hans&sites=yicai', name: '第一财经' },
    { url: 'https://news.google.com/rss/search?q=semiconductor+chip+TSMC+Samsung+SK+hynix+supply+chain&hl=en-US&gl=US&ceid=US:en&sites=nikkei', name: 'Nikkei-亚洲供应链' },
  ],

  apiSources: [
    { name: '财联社', url: 'https://www.cls.cn/api/cache?app=CailianpressWeb&name=telegraph&os=web&sv=8.7.9', enabled: true },
    { name: '金十数据', url: 'https://www.jin10.com/flash_newest.js', enabled: true },
    { name: '东方财富', url: 'https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_new&column=350,35,466,467&order=1&needInteractData=0&page_index=1&page_size=30&req_trace=test', enabled: true },
    { name: '新浪财经', url: 'https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=30&zhibo_id=152&tag_id=0&type=0', enabled: true },
    { name: '华尔街见闻', url: 'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=30', enabled: true },
    // 华尔街见闻医药频道 — 专门的创新药新闻源（礼来/百济/诺和诺德/药明康德等）
    { name: '华尔街见闻医药', url: 'https://api-one.wallstcn.com/apiv1/content/information-flow?channel=medicine&client=pc&limit=40', enabled: true },
  ],
  apiSourceMaxItems: 80,

  serverChanSendkey: process.env.SERVERCHAN_SENDKEY || '',
};

// ETF list — representative tickers for each sector
export const ETFS = [
  { code: '159995', name: '芯片ETF华夏', category: '半导体' },
  { code: '512760', name: '芯片ETF国泰', category: '半导体' },
  { code: '588200', name: '科创芯片ETF嘉实', category: '半导体' },
  { code: '515050', name: '通信ETF华夏', category: '光模块' },
  { code: '515880', name: '通信ETF国泰', category: '光模块' },
  { code: '159811', name: '5GETF博时', category: '光模块' },
  { code: '515120', name: '创新药ETF广发', category: '创新药' },
  { code: '159858', name: '创新药ETF南方', category: '创新药' },
  { code: '159992', name: '创新药ETF银华', category: '创新药' },
  { code: '518880', name: '黄金ETF华安', category: '黄金' },
  { code: '159934', name: '黄金ETF易方达', category: '黄金' },
  { code: '518800', name: '黄金ETF国泰', category: '黄金' },
];

// Sector classification keywords
export const SECTOR_KEYWORDS = {
  '半导体': ['芯片', '半导体', '台积电', 'TSMC', '中芯', 'Nvidia', '英伟达', 'AMD', 'GPU', 'HBM', 'foundry', '代工', '制程', '封装', 'EDA', '光刻', 'ASML', 'DRAM', '存储', '晶圆', 'PCB', '鹏鼎', '封测', '宏碁', '三星'],
  '光模块': ['光模块', '光通信', '硅光', '800G', '1.6T', 'CPO', 'LPO', '数据中心', 'transceiver', 'optical', '中际旭创', '新易盛', '天孚通信', '光迅科技', '中富电路', '光库科技', '博创科技', '德科立', '太辰光', '源杰科技', '仕佳光子', '剑桥科技', '联特科技', '腾景科技', '光云科技', '光膜', '光缆', '光棒', '光纤', '数通', '相干', '单模', '多模', '光器件', '光芯片', '光模块厂'],
  '创新药': ['创新药', 'FDA', '临床试验', '临床', 'NDA', 'BLA', '抗体', 'ADC', '基因', '细胞治疗', 'biotech', 'pharma', '药明康德', '百济神州', '恒瑞医药', '审批', '授权', '出海', 'License', '生物医药', '疫苗', '药品', '医药', '仿制药', '原料药', '抗癌', '肿瘤', 'PROTAC', 'GLP', 'mRNA', '小核酸', 'CRO', 'CDMO', '医保', '集采', '罕见病', '新药', '治疗', '双抗', '抑制剂', 'CAR-T'],
  '黄金': ['黄金', '金价', 'COMEX', 'gold', '美联储', '降息', '利率', '央行购金', '通胀', '紫金矿业', '山东黄金', '中金黄金', '贵金属', 'precious metal', '非农', 'CPI'],
};

// High-signal keywords that alone are enough to place an item in a sector.
// Context keywords in SECTOR_KEYWORDS (利率, 美联储, 治疗, 审批...) are only
// additive — hitting only a context word must NOT classify an item, or e.g. a
// bank-rate story (利率) would land in 黄金.
export const SECTOR_CORE_KEYWORDS = {
  '半导体': ['芯片', '半导体', '台积电', 'TSMC', '中芯', 'Nvidia', '英伟达', 'GPU', 'HBM', 'foundry', '代工', '制程', 'EDA', '光刻', 'ASML', 'DRAM', '晶圆', '封测'],
  '光模块': ['光模块', '光通信', '硅光', '800G', '1.6T', 'CPO', 'LPO', 'transceiver', 'optical', '中际旭创', '新易盛', '天孚通信', '光迅科技', '中富电路', '光纤', '光缆', '光器件', '光芯片', '数通'],
  '创新药': ['创新药', 'FDA', '临床试验', 'NDA', 'BLA', 'ADC', 'biotech', 'pharma', '药明康德', '百济神州', '恒瑞医药', 'mRNA', 'CRO', 'CDMO', '疫苗', '肿瘤', 'License', '出海'],
  '黄金': ['黄金', '金价', 'COMEX', 'gold', '央行购金', '紫金矿业', '山东黄金', '中金黄金', '贵金属', 'precious metal', '现货黄金'],
};

// Keyword rules for local fallback analysis
export const KEYWORD_RULES = [
  { kw: ['Nvidia','英伟达','GPU','H100','H200','B100','B200','Blackwell','Hopper','Rubin'], category: '半导体', impact: '极高', dir: '利好', tickers: '—', time: '短期' },
  { kw: ['TSMC','台积电','foundry','代工','3nm','2nm','先进制程','CoWoS'], category: '半导体', impact: '高', dir: '利好', tickers: '中芯国际', time: '中期' },
  { kw: ['ASML','光刻','lithography','EUV','DUV'], category: '半导体', impact: '高', dir: '分化', tickers: '北方华创、中微公司', time: '中期' },
  { kw: ['HBM','高带宽内存','SK hynix','Samsung','美光','Micron'], category: '半导体', impact: '高', dir: '利好', tickers: '—', time: '短期' },
  { kw: ['chip ban','chip export','chip restriction','芯片管制','出口管制','semiconductor export','sanction','制裁','entity list'], category: '半导体', impact: '极高', dir: '分化', tickers: '中芯国际、北方华创、中微公司', time: '短期' },
  { kw: ['optical','transceiver','光模块','800G','1.6T','800g','1.6t','CPO','LPO','光通信','硅光','silicon photonic'], category: '光模块', impact: '高', dir: '利好', tickers: '中际旭创、新易盛、天孚通信', time: '短期' },
  { kw: ['data center','数据中心','hyperscaler','云服务','cloud','AWS','Azure','Google Cloud'], category: '光模块', impact: '高', dir: '利好', tickers: '中际旭创、工业富联', time: '中期' },
  { kw: ['FDA','approval','clinical trial','临床试验','NDA','BLA','创新药','biotech','pharma','drug approval','抗体','ADC','gene therapy','细胞治疗'], category: '创新药', impact: '极高', dir: '利好', tickers: '百济神州、药明康德、恒瑞医药', time: '中期' },
  { kw: ['药明康德','百济神州','恒瑞医药','信达生物','康龙化成','License-out','出海','授权','BD交易'], category: '创新药', impact: '高', dir: '利好', tickers: '药明康德、百济神州', time: '中期' },
  { kw: ['gold','黄金','COMEX','gold price','金价','gold ETF','央行购金','central bank gold','gold reserve','precious metal'], category: '黄金', impact: '高', dir: '利好', tickers: '紫金矿业、山东黄金', time: '短期' },
  { kw: ['Fed','美联储','rate cut','降息','利率','inflation','通胀','gold forecast','黄金预测'], category: '黄金', impact: '高', dir: '利好', tickers: '紫金矿业、中金黄金', time: '短期' },
  { kw: ['chip','semiconductor','半导体','芯片','processor','封测','EDA','IP'], category: '半导体', impact: '中', dir: '利好', tickers: '—', time: '中期' },
  { kw: ['server','服务器','rack','机架','cooling','散热','液冷'], category: '光模块', impact: '中', dir: '利好', tickers: '工业富联、浪潮信息', time: '短期' },
  { kw: ['quantum','量子','quantum computing'], category: '半导体', impact: '低', dir: '利好', tickers: '—', time: '长期' },
  { kw: ['China chip','国产替代','自主可控','localization','domestic chip','国产芯片'], category: '半导体', impact: '高', dir: '利好', tickers: '中芯国际、北方华创、海光信息', time: '中期' },
];
