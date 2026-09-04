// ===== 个人快递管理系统 - 驿站分组版 =====
(function() {
  'use strict';

  // ===== 快递短信/文本解析 =====
  function parseExpressText(text) {
    const result = {
      pickupCode: '',
      stationName: '',
      stationAddress: '',
      carrier: '',
      isExpress: false
    };

    if (!text || typeof text !== 'string') return result;
    const t = text.trim();

    // 常见快递公司关键词
    const carriers = [
      '顺丰速运', '顺丰', '中通快递', '中通', '圆通速递', '圆通',
      '申通快递', '申通', '韵达快递', '韵达', '极兔速递', '极兔',
      '京东物流', '京东', '邮政EMS', 'EMS', '邮政', '百世快递', '百世',
      '菜鸟速递', '丹鸟', '德邦', '安能', '天天快递', '天天'
    ];

    // ---- 1. 取件码识别（最关键，要精确） ----
    // 模式：
    //   凭XX-XX-XXXX  →  "凭"后面跟的是取件码
    //   取件码XXXX   →  "取件码"后面跟的
    //   取件码:XXXX / 取件码：XXXX
    //   取件号 / 提货码 / 取货码
    // 取件码格式：数字+横线组合（如 14-2-0117、10-5-9936、9-3-4709），也可能带字母前缀（A-12-3456）

    // 优先匹配：凭 + 取件码 + 到/免费取/取件
    let m = t.match(/凭([A-Za-z0-9\-]{3,20}?)(?:到|免费取|取件|领取|取|，|。|\s|$)/);
    if (m && !/\d{10,}/.test(m[1])) {
      // 排除纯长数字（那是快递单号）
      result.pickupCode = m[1].trim();
    }

    // 次优先：取件码/取件号/提货码/取货码 + 冒号空格 + 内容
    if (!result.pickupCode) {
      m = t.match(/(?:取件码|取件号|提货码|取货码)\s*[：:]\s*([A-Za-z0-9\-]{3,20})/);
      if (m && !/\d{10,}/.test(m[1])) {
        result.pickupCode = m[1].trim();
      }
    }

    // 再次：取件码/取件号 + 直接跟数字+横线
    if (!result.pickupCode) {
      m = t.match(/(?:取件码|取件号|提货码|取货码)([A-Za-z0-9\-]{3,20})/);
      if (m && !/\d{10,}/.test(m[1])) {
        result.pickupCode = m[1].trim();
      }
    }

    // 兜底：数字-数字-数字（典型驿站取件码格式，如 14-2-0117）
    // 但要排除前面有"单号"、"运单"等字样的
    if (!result.pickupCode) {
      // 先排除快递单号上下文
      const cleanText = t.replace(/(?:快递单号|运单号|单号|包裹单号)[：:\s]*\d+/g, '');
      m = cleanText.match(/(\d{1,4}-\d{1,3}-\d{3,6})/);
      if (m) {
        result.pickupCode = m[1].trim();
      }
    }

    // ---- 2. 驿站名称识别 ----
    // 模式：
    //   到XX店取件 / 到XX驿站取件
    //   已到XX驿站 / 已到XX店
    //   存放XX驿站 / 存放XX喵站 / 存放XX店
    //   由XX店送到家门口
    //   XX驿站（店名+地址往往在一起，需要智能拆分）

    // 驿站类型关键词
    const stationTypes = [
      '菜鸟驿站', '驿站', '喵站', '快递超市', '快递驿站',
      '服务中心', '代收点', '自提点', '驿站店', '驿站（',
      '丰巢', '速递易', '中邮速递易', '妈妈驿站', '驿收发'
    ];

    // 找所有候选驿站位置
    let stationCandidates = [];

    // 模式1（最高优先级）：已到XXX
    // 例如：已到福鼎家园东门7-1顺丰驿站
    m = t.match(/已到(.+?)(?:，|。|；|凭|取|$)/);
    if (m) {
      const candidate = m[1].trim();
      if (isLikelyStation(candidate)) {
        stationCandidates.push(candidate);
      }
    }

    // 模式2：凭XXX到XXX取件 → "到"后面的是驿站+地址
    // 注意：凭和到之间的内容必须短（取件码），避免匹配到后面的"到店咨询"等
    // 例如：凭14-2-0117到杭州余杭...取件
    if (stationCandidates.length === 0) {
      m = t.match(/凭([A-Za-z0-9\-]{3,20})到(.+?)(?:取件|领取|取|，|。|；|$)/);
      if (m) {
        const candidate = m[2].trim();
        if (isLikelyStation(candidate)) {
          stationCandidates.push(candidate);
        }
      }
    }

    // 模式3：存放XXX
    if (stationCandidates.length === 0) {
      m = t.match(/(?:存放|放至|放在|放到|已放入|放入)(.+?)(?:，|。|；|取件码|凭|$)/);
      if (m) {
        const candidate = m[1].trim();
        if (isLikelyStation(candidate)) {
          stationCandidates.push(candidate);
        }
      }
    }

    // 模式4：由XX店送到 / 由XX驿站
    if (stationCandidates.length === 0) {
      m = t.match(/由(.+?)(?:送到|送达|派送|，|。|$)/);
      if (m) {
        const candidate = m[1].trim();
        if (isLikelyStation(candidate)) {
          stationCandidates.push(candidate);
        }
      }
    }

    // 模式5：包含驿站/店/喵站/超市/代收点/自提点关键词的短语
    if (stationCandidates.length === 0) {
      m = t.match(/([\u4e00-\u9fa5A-Za-z0-9\-·\s]+?(?:驿站|店|喵站|快递超市|超市|代收点|自提点|服务中心))/);
      if (m) {
        const candidate = m[1].trim();
        if (isLikelyStation(candidate)) {
          stationCandidates.push(candidate);
        }
      }
    }

    // 从候选中选出最好的驿站名
    if (stationCandidates.length > 0) {
      const candidate = stationCandidates[0];
      // 尝试拆分驿站名称和地址
      // 规则：如果包含"店"或"驿站"等关键词，关键词及前面的部分作为名称，后面作为地址
      // 比如："杭州余杭福鼎家园晓风苑6-5店" → 名称是"菜鸟驿站福鼎家园晓风苑6-5店"，地址就是完整地址
      
      // 简单处理：整个字符串作为驿站名展示（因为用户说"大标题是驿站名"）
      // 但如果有明显的地址结构，可以把地址部分单独提取
      result.stationName = candidate;
      result.stationAddress = '';

      // 尝试从驿站名中提取地址
      // 常见模式：[城市/区域][小区/地点][楼栋][驿站类型]
      // 如："杭州余杭福鼎家园晓风苑6-5店" → 名称是"福鼎家园晓风苑6-5店"，地址是"杭州余杭"
      // 简化处理：如果包含驿站类型关键词，完整字符串作为名称
    }

    // 如果开头有【菜鸟驿站】【驿小哥】等，加到驿站名称前面
    m = t.match(/^【([^】]+)】/);
    if (m) {
      const sender = m[1];
      // 如果发件方本身是驿站类型，作为前缀
      if (sender.includes('驿站') || sender.includes('喵站') || sender.includes('快递') || sender.includes('小哥')) {
        if (result.stationName && !result.stationName.includes(sender)) {
          // 如果驿站名里没有发件方名称，加上
          if (sender === '菜鸟驿站' && !result.stationName.startsWith('菜鸟驿站')) {
            result.stationName = '菜鸟驿站（' + result.stationName + '）';
          }
        }
        // 如果还没有驿站名，用发件方当名称（不太准确，但比空好）
        if (!result.stationName) {
          result.stationName = sender;
        }
      }
    }

    // ---- 3. 快递公司识别 ----
    // 先找到所有候选快递公司，再判断哪个是真的
    let carrierCandidates = [];
    for (const c of carriers) {
      const idx = t.indexOf(c);
      if (idx !== -1) {
        // 检查这个位置后面是不是跟着驿站相关的词
        const afterIdx = idx + c.length;
        const suffix = t.substring(afterIdx, afterIdx + 5);
        const isStationSuffix = /^(驿站|站点|快递|超市|柜|点|中心|门店|服务|驿站)/.test(suffix);

        // 如果后面跟着驿站相关词，说明是驿站名的一部分，不算快递公司
        if (!isStationSuffix) {
          carrierCandidates.push({ name: c, index: idx });
        }
      }
    }

    // 从【】里的发件方也可能是快递公司
    if (!result.carrier && m) {
      const sender = m[1];
      for (const c of carriers) {
        if (sender.includes(c) || c.includes(sender)) {
          carrierCandidates.push({ name: c, index: -1 });
          break;
        }
      }
    }

    // 取位置最靠前的作为快递公司（通常快递名会出现在比较前面）
    if (carrierCandidates.length > 0) {
      carrierCandidates.sort((a, b) => a.index - b.index);
      result.carrier = carrierCandidates[0].name;
    }

    // ---- 4. 判断是否是快递短信 ----
    if (result.pickupCode || result.stationName) {
      // 有取件码或驿站名，基本确定是快递
      result.isExpress = true;
    } else if (result.carrier && (t.includes('包裹') || t.includes('快递') || t.includes('到站') || t.includes('取件'))) {
      result.isExpress = true;
    }

    // 清理一下取件码末尾可能多余的字符
    if (result.pickupCode) {
      result.pickupCode = result.pickupCode.replace(/[，。、\s]+$/, '').trim();
    }
    if (result.stationName) {
      result.stationName = result.stationName.replace(/[，。、\s]+$/, '').trim();
    }

    return result;
  }

  /**
   * 判断字符串是否像一个驿站名称
   * 过滤掉"店咨询"这种明显不是驿站的误匹配
   */
  function isLikelyStation(name) {
    if (!name || name.length < 2) return false;

    // 太短的不是驿站（如"店"只有一个字）
    if (name.length < 3) return false;

    // 排除明显不合理的短语
    const badPatterns = [
      '店咨询', '店联系', '店详询', '到店', '进店', '门店',
      '咨询', '联系', '查询', '详情', '客服', '电话',
      '疑问', '问题', '谢谢', '感谢', '回复', '取免费',
      '免费取', '取快递', '取包裹'
    ];
    for (const bp of badPatterns) {
      if (name === bp || name.endsWith(bp) || name.startsWith(bp)) {
        return false;
      }
    }

    // 必须包含中文（驿站名都是中文）
    if (!/[\u4e00-\u9fa5]/.test(name)) return false;

    // 如果包含驿站类型关键词，基本确定是
    const stationKeywords = ['驿站', '喵站', '菜鸟', '丰巢', '快递柜', '快递超市', '代收点', '自提点', '服务中心', '速递', '站点'];
    for (const kw of stationKeywords) {
      if (name.includes(kw)) return true;
    }

    // 包含数字-数字格式（楼栋号）+ 店/驿站 结尾，很可能是驿站
    if (/\d+-\d+.*(店|驿站|站)$/.test(name)) return true;

    // 以"店"结尾但前面是地址结构的
    if (/[\u4e00-\u9fa5\d\-]+店$/.test(name) && name.length >= 5) return true;

    // 其他情况：长度大于等于5且包含中文，暂算有效（兜底）
    return name.length >= 5;
  }

  // ===== 数据存储 =====
  const STORAGE_KEY = 'my_express_parcels_v2';
  const SETTINGS_KEY = 'my_express_settings_v2';
  const PENDING_KEY = 'my_express_pending_v1';
  let parcels = [];
  let pendingParcels = [];
  let settings = {
    autoClean: false,
    retentionDays: 7,
    vibration: true,  // 震动提醒，默认开启
    updateUrl: 'https://zy2574520636.github.io/express-manager/version.json',    // 版本检查地址
    lastUpdateCheck: 0, // 上次检查更新时间
    monitorApps: {},   // 监听的APP列表，{包名: true/false}，默认全不选
    stationAliases: {},  // 驿站别名映射 {别名: 标准名}，用于合并同名驿站
    hiddenStations: [],  // 已隐藏的驿站列表（只是不显示，数据保留，收到新快递自动恢复）
    pendingConfirmEnabled: false // 新快递先待确认再入库
  };

  // 支持监听的APP列表
  const SUPPORTED_MONITOR_APPS = [
    // 购物APP
    { pkg: 'com.taobao.taobao', name: '淘宝', icon: '🛒', desc: '阿里系购物平台', category: 'shopping' },
    { pkg: 'com.tmall.wireless', name: '天猫', icon: '🐱', desc: '阿里系购物平台', category: 'shopping' },
    { pkg: 'com.xunmeng.pinduoduo', name: '拼多多', icon: '🍊', desc: '拼多多购物', category: 'shopping' },
    { pkg: 'com.jingdong.app.mall', name: '京东', icon: '🐕', desc: '京东商城', category: 'shopping' },
    { pkg: 'com.xingin.xhs', name: '小红书', icon: '📕', desc: '小红书商城', category: 'shopping' },
    { pkg: 'com.ss.android.ugc.aweme', name: '抖音', icon: '🎵', desc: '抖音商城', category: 'shopping' },
    // 快递APP
    { pkg: 'com.cainiao.wireless', name: '菜鸟裹裹', icon: '📦', desc: '菜鸟官方APP', category: 'express' },
    { pkg: 'com.sf.activity', name: '顺丰速运', icon: '✈️', desc: '顺丰快递', category: 'express' },
    { pkg: 'sto.android.activity', name: '申通', icon: '📮', desc: '申通快递', category: 'express' },
    { pkg: 'com.yto.xiaoxiao', name: '圆通速递', icon: '📬', desc: '圆通快递', category: 'express' },
    { pkg: 'com.zto.android.customer', name: '中通快递', icon: '📭', desc: '中通快递', category: 'express' },
    { pkg: 'com.yunda.express', name: '韵达快递', icon: '📨', desc: '韵达快递', category: 'express' },
    { pkg: 'com.jtexpress.www', name: '极兔速递', icon: '🐰', desc: '极兔快递', category: 'express' },
    { pkg: 'fcbox.client.android', name: '丰巢', icon: '🔐', desc: '丰巢快递柜', category: 'express' },
    { pkg: 'com.tuxi.life', name: '兔喜生活', icon: '🐇', desc: '兔喜快递超市', category: 'express' },
    { pkg: 'idatalv.shouqianyu.fl', name: '闲鱼', icon: '🐟', desc: '闲鱼二手平台', category: 'shopping' },
    { pkg: 'com.jdl.jsf', name: '京东物流', icon: '📦', desc: '京东物流', category: 'express' }
  ];

  // ===== DOM 元素 =====
  const els = {};

  function initEls() {
    els.btnSettings = document.getElementById('btn-settings');
    els.btnAdd = document.getElementById('btn-add');
    els.btnExport = document.getElementById('btn-export');
    els.btnImport = document.getElementById('btn-import');
    els.fileImport = document.getElementById('file-import');
    els.modalOverlay = document.getElementById('modal-overlay');
    els.modalClose = document.getElementById('modal-close');
    els.btnCancel = document.getElementById('btn-cancel');
    els.parcelForm = document.getElementById('parcel-form');
    els.modalTitle = document.getElementById('modal-title');
    els.stationList = document.getElementById('station-list');
    els.emptyState = document.getElementById('empty-state');
    els.searchInput = document.getElementById('search-input');
    els.filterStatus = document.getElementById('filter-status');
    els.sortBy = document.getElementById('sort-by');
    els.stationCount = document.getElementById('station-count');
    els.btnStationManage = document.getElementById('btn-station-manage');
    els.todayOverview = document.getElementById('today-overview');
    els.todayCount = document.getElementById('today-count');
    els.todayDesc = document.getElementById('today-desc');
    els.completedSection = document.getElementById('completed-section');
    els.completedList = document.getElementById('completed-list');
    els.completedCount = document.getElementById('completed-count');
    els.pendingConfirmBar = document.getElementById('pending-confirm-bar');
    els.pendingConfirmCount = document.getElementById('pending-confirm-count');
    els.statTotal = document.getElementById('stat-total');
    els.statTransit = document.getElementById('stat-transit');
    els.statPickup = document.getElementById('stat-pickup');
    els.statDelivered = document.getElementById('stat-delivered');
    els.toast = document.getElementById('toast');
    els.detailOverlay = document.getElementById('detail-overlay');
    els.detailClose = document.getElementById('detail-close');
    els.detailContent = document.getElementById('detail-content');

    // 粘贴识别
    els.pasteInput = document.getElementById('paste-input');
    els.btnPasteRecognize = document.getElementById('btn-paste-recognize');

    // 表单字段（简化版：取件码、驿站名称、快递公司）
    els.formFields = {
      id: document.getElementById('parcel-id'),
      pickupCode: document.getElementById('pickup-code'),
      stationName: document.getElementById('station-name'),
      carrier: document.getElementById('carrier')
    };
  }

  // ===== 存储操作 =====
  function loadData() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      parcels = data ? JSON.parse(data) : [];
      // 数据迁移：旧版本 location 字段 -> stationName / stationAddress
      parcels.forEach(p => {
        if (!p.stationName && p.location) {
          p.stationName = p.location;
          p.stationAddress = p.notes || '';
        }
      });
    } catch (e) {
      parcels = [];
      console.error('加载数据失败:', e);
    }
    try {
      const pd = localStorage.getItem(PENDING_KEY);
      pendingParcels = pd ? JSON.parse(pd) : [];
    } catch (e) {
      pendingParcels = [];
      console.error('加载待确认数据失败:', e);
    }
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) {
        settings = { ...settings, ...JSON.parse(s) };
      }
    } catch (e) {
      console.error('加载设置失败:', e);
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parcels));
    } catch (e) {
      showToast('保存失败，请检查浏览器存储设置', 'error');
      console.error('保存数据失败:', e);
    }
  }

  function savePendingParcels() {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(pendingParcels));
    } catch (e) {
      console.error('保存待确认数据失败:', e);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('保存设置失败:', e);
    }
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // ===== 工具函数 =====
  function showToast(message, type = 'success') {
    els.toast.textContent = message;
    els.toast.className = 'toast show ' + type;
    setTimeout(() => {
      els.toast.className = 'toast';
    }, 2500);
  }

  // 自定义确认对话框
  function showConfirmDialog(message, options = {}) {
    return new Promise((resolve) => {
      const dialog = document.getElementById('confirm-dialog');
      const iconEl = document.getElementById('confirm-dialog-icon');
      const textEl = document.getElementById('confirm-dialog-text');
      const okBtn = document.getElementById('confirm-dialog-ok');
      const cancelBtn = document.getElementById('confirm-dialog-cancel');

      if (!dialog) {
        resolve(confirm(message));
        return;
      }

      // 设置图标和文本
      iconEl.textContent = options.icon || '⚠️';
      textEl.textContent = message;

      // 设置按钮文字
      okBtn.textContent = options.okText || '确定';
      cancelBtn.textContent = options.cancelText || '取消';

      // 显示对话框
      dialog.style.display = 'flex';

      // 清理函数
      const cleanup = () => {
        dialog.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        dialog.onclick = null;
      };

      // 确定按钮
      okBtn.onclick = () => {
        cleanup();
        resolve(true);
      };

      // 取消按钮
      cancelBtn.onclick = () => {
        cleanup();
        resolve(false);
      };

      // 点击背景关闭（视为取消）
      dialog.onclick = (e) => {
        if (e.target === dialog) {
          cleanup();
          resolve(false);
        }
      };
    });
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function getDaysDiff(dateStr) {
    if (!dateStr) return null;
    const target = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // 震动提醒
  function vibrate(pattern) {
    if (!settings.vibration) return;
    const pat = pattern || [100, 50, 100];
    // APP 环境优先使用原生震动
    if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === 'function') {
      try {
        window.AndroidBridge.vibrate(JSON.stringify(pat));
        return;
      } catch (e) { /* ignore */ }
    }
    if (navigator.vibrate) {
      navigator.vibrate(pat);
    }
  }

  // ===== 驿站分组 =====
  function getStationKey(p) {
    let name = (p.stationName || '').trim();
    const addr = (p.stationAddress || '').trim();
    // 应用驿站别名映射（合并规则）
    if (name && settings.stationAliases && settings.stationAliases[name]) {
      name = settings.stationAliases[name];
    }
    return name || addr || '未设置驿站';
  }

  function getStationName(p) {
    let name = (p.stationName || '').trim();
    // 应用驿站别名映射
    if (name && settings.stationAliases && settings.stationAliases[name]) {
      name = settings.stationAliases[name];
    }
    return name || '未设置驿站';
  }

  function getStationAddress(p) {
    const addr = (p.stationAddress || '').trim();
    return addr || '';
  }

  function groupByStation(filteredParcels, includeEmpty = true) {
    const stations = {};
    filteredParcels.forEach(p => {
      const key = getStationKey(p);
      if (!stations[key]) {
        stations[key] = {
          name: getStationName(p),
          address: getStationAddress(p),
          parcels: [],
          pickupCount: 0,
          totalCount: 0,
          latestCreated: 0
        };
      }
      stations[key].parcels.push(p);
      stations[key].totalCount++;
      if (p.status === '待取件') stations[key].pickupCount++;
      if (p.createdAt > stations[key].latestCreated) {
        stations[key].latestCreated = p.createdAt;
      }
    });

    let result = Object.values(stations);

    // 过滤掉隐藏的驿站
    if (settings.hiddenStations && settings.hiddenStations.length > 0) {
      result = result.filter(s => !settings.hiddenStations.includes(s.name));
    }

    return result;
  }

  // ===== 筛选与排序 =====
  function getFilteredParcels() {
    const search = els.searchInput ? els.searchInput.value.toLowerCase().trim() : '';
    const status = els.filterStatus ? els.filterStatus.value : 'all';

    return parcels.filter(p => {
      if (status !== 'all') {
        if (status === '已取件') {
          // 已取件和已签收都算已完成
          if (p.status !== '已取件' && p.status !== '已签收') return false;
        } else {
          if (p.status !== status) return false;
        }
      }
      if (search) {
        const haystack = (
          p.itemName +
          p.trackingNumber +
          p.pickupCode +
          p.carrier +
          (p.stationName || '') +
          (p.stationAddress || '') +
          (p.notes || '')
        ).toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  function sortStations(stations) {
    const sortBy = els.sortBy ? els.sortBy.value : 'pickup_count';
    return stations.sort((a, b) => {
      // 第一优先级：有待取件的排前面
      const aHasPending = a.pickupCount > 0 ? 1 : 0;
      const bHasPending = b.pickupCount > 0 ? 1 : 0;
      if (bHasPending !== aHasPending) return bHasPending - aHasPending;

      // 第二优先级：按用户选择的方式排
      switch (sortBy) {
        case 'pickup_count':
          if (b.pickupCount !== a.pickupCount) return b.pickupCount - a.pickupCount;
          return b.totalCount - a.totalCount;
        case 'station_name':
          return a.name.localeCompare(b.name, 'zh-CN');
        case 'created_desc':
        default:
          return b.latestCreated - a.latestCreated;
      }
    });
  }

  // ===== 渲染 =====
  function renderStats() {
    const total = parcels.length;
    const transit = parcels.filter(p => p.status === '运输中' || p.status === '派送中' || p.status === '待发货').length;
    const pickup = parcels.filter(p => p.status === '待取件').length;
    const delivered = parcels.filter(p => p.status === '已取件' || p.status === '已签收').length;

    if (els.statTotal) els.statTotal.textContent = total;
    if (els.statTransit) els.statTransit.textContent = transit;
    if (els.statPickup) els.statPickup.textContent = pickup;
    if (els.statDelivered) els.statDelivered.textContent = delivered;
  }

  function renderParcelCard(p, compact) {
    const daysDiff = getDaysDiff(p.expectedDate);
    let dateText = '';
    if (p.expectedDate) {
      if (daysDiff > 0) {
        dateText = `预计 ${daysDiff} 天后到达`;
      } else if (daysDiff === 0) {
        dateText = `预计今天到达`;
      } else {
        dateText = `已超过预计 ${Math.abs(daysDiff)} 天`;
      }
    }

    const addDateStr = formatDate(new Date(p.createdAt).toISOString().split('T')[0]);

    const pickupCodeHtml = p.pickupCode ? `
      <div class="pickup-code-box" data-action="copy-code" data-code="${escapeHtml(p.pickupCode)}" title="点击复制取件码">
        <span class="pickup-code-label">📮 取件码</span>
        <span class="pickup-code-date">${addDateStr}</span>
        <span class="pickup-code-value">${escapeHtml(p.pickupCode)}</span>
      </div>
    ` : '';

    const trackingHtml = p.trackingNumber ? `<span>📦 ${escapeHtml(p.trackingNumber.substring(0, 12) + (p.trackingNumber.length > 12 ? '...' : ''))}</span>` : '';

    const isCompleted = p.status === '已取件' || p.status === '已签收';
    const completedClass = isCompleted ? ' parcel-completed' : '';
    const compactClass = compact ? ' compact' : '';

    return `
      <div class="parcel-card status-${escapeHtml(p.status)}${completedClass}${compactClass}" data-id="${p.id}">
        <div class="swipe-bg swipe-bg-left">
          <span class="swipe-bg-text">✓ 已取件</span>
        </div>
        <div class="swipe-bg swipe-bg-right">
          <span class="swipe-bg-text">🗑 删除</span>
        </div>
        <div class="parcel-content">
          <div class="parcel-top">
            <div class="parcel-name">${escapeHtml(p.itemName)}</div>
          </div>
          <div class="parcel-meta">
            <span class="status-badge status-${escapeHtml(p.status)}">${escapeHtml(p.status)}</span>
            ${trackingHtml}
          </div>
          ${pickupCodeHtml}
        </div>
      </div>
    `;
  }

  function renderStationCard(station) {
    const pendingParcels = station.parcels.filter(p => p.status !== '已取件' && p.status !== '已签收');
    const hasPending = pendingParcels.length > 0;
    const noPendingClass = hasPending ? '' : ' no-pending';

    // 没有待取件时，显示精简卡片
    if (!hasPending) {
      return `
        <div class="station-card station-card-compact${noPendingClass}" data-station="${encodeURIComponent(station.name)}">
          <div class="station-compact-row">
            <span class="station-compact-icon">🏪</span>
            <span class="station-compact-name">${escapeHtml(station.name)}</span>
            <div class="station-compact-stat">
              <span class="compact-stat-num">0</span>
              <span class="compact-stat-label">待取件</span>
            </div>
          </div>
        </div>
      `;
    }

    // 待取件：按状态优先级排序，待取件最前
    pendingParcels.sort((a, b) => {
      const statusOrder = { '待取件': 0, '派送中': 1, '运输中': 2, '待发货': 3 };
      const orderA = statusOrder[a.status] ?? 99;
      const orderB = statusOrder[b.status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return b.createdAt - a.createdAt;
    });

    // 批量签收按钮（只有待取件数量>1时显示）
    const pickupOnlyParcels = pendingParcels.filter(p => p.status === '待取件');
    const actionBarHtml = pickupOnlyParcels.length > 1 ? `
      <div class="station-action-bar">
        <span class="station-action-text">该驿站共 ${pickupOnlyParcels.length} 件待取</span>
        <button class="btn-pickup-all" data-action="pickup-all" data-station="${encodeURIComponent(station.name)}">
          全部取完
        </button>
      </div>
    ` : '';

    const pendingHtml = `<div class="parcel-group">
           ${pendingParcels.map(p => renderParcelCard(p, true)).join('')}
         </div>`;

    return `
      <div class="station-card${noPendingClass}" data-station="${encodeURIComponent(station.name)}">
        <div class="station-header">
          <div class="station-info">
            <div class="station-name">
              <span class="station-icon">🏪</span>
              <span>${escapeHtml(station.name)}</span>
            </div>
            ${station.address ? `<div class="station-address">📍 ${escapeHtml(station.address)}</div>` : ''}
          </div>
          <div class="station-stats">
            <div class="station-stat">
              <div class="station-stat-num pickup">${station.pickupCount}</div>
              <div class="station-stat-label">待取件</div>
            </div>
          </div>
        </div>
        <div class="station-parcels">
          ${pendingHtml}
        </div>
        ${actionBarHtml}
      </div>
    `;
  }

  function renderTodayOverview() {
    const pendingParcelsList = parcels.filter(p => p.status === '待取件');
    const count = pendingParcelsList.length;

    // 统计有几个驿站
    const stationMap = {};
    pendingParcelsList.forEach(p => {
      const key = p.stationName || '未设置驿站';
      stationMap[key] = true;
    });
    const stationCount = Object.keys(stationMap).length;

    if (els.todayOverview) els.todayOverview.style.display = 'flex';
    if (els.todayCount) els.todayCount.textContent = count;
    if (els.todayDesc) {
      if (count === 0) {
        els.todayDesc.textContent = '暂无待取快递 🎉';
      } else {
        els.todayDesc.textContent = `${stationCount} 个驿站待取`;
      }
    }
  }

  // ===== 待确认快递 =====
  function renderPendingConfirmBar() {
    if (!els.pendingConfirmBar) return;

    if (!settings.pendingConfirmEnabled || pendingParcels.length === 0) {
      els.pendingConfirmBar.style.display = 'none';
      return;
    }

    els.pendingConfirmBar.style.display = 'flex';
    els.pendingConfirmCount.textContent = pendingParcels.length;
  }

  /**
   * 确认单个待确认快递入库
   */
  function confirmPendingParcel(id) {
    const idx = pendingParcels.findIndex(p => p.id === id);
    if (idx === -1) return;

    const parcel = pendingParcels[idx];
    pendingParcels.splice(idx, 1);
    parcels.unshift(parcel);

    saveData();
    savePendingParcels();
    renderAll();
    renderPendingConfirmBar();
    showToast('已确认入库', 'success');
  }

  /**
   * 全部确认
   */
  function confirmAllPending() {
    if (pendingParcels.length === 0) return;

    if (!confirm(`确定将 ${pendingParcels.length} 个待确认快递全部入库吗？`)) return;

    pendingParcels.forEach(p => parcels.unshift(p));
    pendingParcels = [];

    saveData();
    savePendingParcels();
    renderAll();
    renderPendingConfirmBar();
    showToast('全部确认入库', 'success');
  }

  /**
   * 拒绝单个待确认快递
   */
  function rejectPendingParcel(id) {
    const idx = pendingParcels.findIndex(p => p.id === id);
    if (idx === -1) return;

    pendingParcels.splice(idx, 1);
    savePendingParcels();
    renderPendingConfirmBar();
    showToast('已忽略', 'info');
  }

  /**
   * 打开待确认列表弹窗
   */
  function openPendingListModal() {
    if (pendingParcels.length === 0) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '2000';
    overlay.innerHTML = `
      <div class="merge-station-modal" style="max-width:420px;">
        <div class="merge-station-header">待确认快递（${pendingParcels.length} 个）</div>
        <div class="merge-station-list" style="max-height:60vh;padding:8px 0;">
          ${pendingParcels.map(p => `
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:14px;font-weight:600;">
                    ${p.pickupCode ? '📮 ' + escapeHtml(p.pickupCode) : escapeHtml(p.itemName)}
                  </div>
                  <div style="font-size:12px;color:var(--muted);margin-top:3px;">
                    ${p.stationName ? '🏪 ' + escapeHtml(p.stationName) : ''}
                    ${p.carrier ? ' · 🚚 ' + escapeHtml(p.carrier) : ''}
                  </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                  <button class="station-manage-btn danger" data-action="reject" data-id="${p.id}">忽略</button>
                  <button class="btn btn-primary btn-sm" data-action="confirm" data-id="${p.id}">确认</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });

    overlay.querySelectorAll('[data-action="confirm"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        confirmPendingParcel(id);
        document.body.removeChild(overlay);
      });
    });

    overlay.querySelectorAll('[data-action="reject"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        rejectPendingParcel(id);
        // 如果还有剩余，刷新弹窗
        if (pendingParcels.length > 0) {
          document.body.removeChild(overlay);
          openPendingListModal();
        } else {
          document.body.removeChild(overlay);
        }
      });
    });
  }

  function renderCompletedList(filtered) {
    const completedParcels = filtered.filter(p => p.status === '已取件' || p.status === '已签收');

    if (completedParcels.length === 0) {
      if (els.completedSection) els.completedSection.style.display = 'none';
      return;
    }

    // 按完成时间倒序
    completedParcels.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

    if (els.completedSection) els.completedSection.style.display = 'block';
    if (els.completedCount) els.completedCount.textContent = `共 ${completedParcels.length} 件`;

    if (els.completedList) {
      els.completedList.innerHTML = completedParcels.map(p => {
        const dateStr = p.updatedAt
          ? formatDate(new Date(p.updatedAt).toISOString().split('T')[0])
          : formatDate(new Date(p.createdAt).toISOString().split('T')[0]);
        return `
          <div class="completed-item" data-id="${p.id}">
            <span class="completed-item-icon">✅</span>
            <div class="completed-item-info">
              <div class="completed-item-code">${escapeHtml(p.pickupCode || p.itemName || '快递')}</div>
              <div class="completed-item-meta">
                ${p.carrier ? escapeHtml(p.carrier) + ' · ' : ''}
                ${p.stationName ? escapeHtml(p.stationName) + ' · ' : ''}
                ${dateStr}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  function renderParcelList() {
    const filtered = getFilteredParcels();
    const statusFilter = els.filterStatus ? els.filterStatus.value : 'all';

    // 用所有快递来分组（包括已取件的），这样驿站不会因为取完就消失
    const allVisible = filtered;
    const stations = sortStations(groupByStation(allVisible));

    const pendingStationCount = stations.filter(s => s.pickupCount > 0).length;
    if (els.stationCount) els.stationCount.textContent = `${pendingStationCount} 个驿站待取`;

    if (filtered.length === 0) {
      if (els.stationList) els.stationList.innerHTML = '';
      if (els.completedSection) els.completedSection.style.display = 'none';
      if (els.emptyState) els.emptyState.style.display = parcels.length === 0 ? 'block' : 'none';
      if (parcels.length > 0 && els.stationList) {
        els.stationList.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">没有符合条件的快递</div>';
      }
      return;
    }

    if (els.emptyState) els.emptyState.style.display = 'none';

    // 已取件状态筛选时，只显示已取件模块，不显示驿站
    if (statusFilter === '已取件') {
      if (els.stationList) els.stationList.innerHTML = '';
      renderCompletedList(filtered);
      return;
    }

    // 待取件状态筛选时，只显示有待取件的驿站，不显示已取件模块
    if (statusFilter === '待取件') {
      const pendingStations = stations.filter(s => s.pickupCount > 0);
      if (els.stationList) els.stationList.innerHTML = pendingStations.map(s => renderStationCard(s)).join('');
      if (els.completedSection) els.completedSection.style.display = 'none';
      return;
    }

    // 全部状态：所有驿站 + 已取件模块
    // 有待取件的显示完整卡片，无待取件的显示精简卡片
    if (els.stationList) els.stationList.innerHTML = stations.map(s => renderStationCard(s)).join('');
    renderCompletedList(filtered);
  }

  function renderAll() {
    renderStats();
    renderTodayOverview();
    renderPendingConfirmBar();
    renderParcelList();
  }

  // ===== 弹窗操作 =====
  function openAddModal() {
    els.modalTitle.textContent = '添加快递';
    els.parcelForm.reset();
    els.formFields.id.value = '';
    if (els.pasteInput) els.pasteInput.value = '';
    els.modalOverlay.style.display = 'flex';
    setTimeout(() => els.formFields.pickupCode.focus(), 100);
  }

  function openEditModal(id) {
    const parcel = parcels.find(p => p.id === id);
    if (!parcel) return;

    els.modalTitle.textContent = '编辑快递';
    els.formFields.id.value = parcel.id;
    els.formFields.pickupCode.value = parcel.pickupCode || '';
    els.formFields.stationName.value = parcel.stationName || '';
    els.formFields.carrier.value = parcel.carrier || '';

    // 编辑时隐藏粘贴识别区域
    if (els.pasteInput) els.pasteInput.value = '';

    els.modalOverlay.style.display = 'flex';
  }

  function closeModal() {
    els.modalOverlay.style.display = 'none';
  }

  // 粘贴识别
  function handlePasteRecognize() {
    const text = els.pasteInput ? els.pasteInput.value : '';
    if (!text || !text.trim()) {
      showToast('请先粘贴短信内容', 'warning');
      return;
    }

    const result = parseExpressText(text);
    let filled = 0;

    if (result.pickupCode) {
      els.formFields.pickupCode.value = result.pickupCode;
      filled++;
    }
    if (result.stationName) {
      els.formFields.stationName.value = result.stationName;
      filled++;
    }
    if (result.carrier) {
      els.formFields.carrier.value = result.carrier;
      filled++;
    }

    if (filled > 0) {
      showToast(`识别成功：已填入 ${filled} 项`, 'success');
    } else {
      showToast('未能识别出快递信息，请手动填写', 'warning');
    }
  }

  function saveParcel(e) {
    e.preventDefault();

    const id = els.formFields.id.value;
    const pickupCode = els.formFields.pickupCode.value.trim();
    const stationName = els.formFields.stationName.value.trim();
    const carrier = (els.formFields.carrier.value || '').trim();

    // 必填校验：取件码 + 驿站名称
    if (!pickupCode) {
      showToast('请输入取件码', 'warning');
      els.formFields.pickupCode.focus();
      return;
    }
    if (!stationName) {
      showToast('请输入驿站名称', 'warning');
      els.formFields.stationName.focus();
      return;
    }

    const data = {
      itemName: carrier ? (carrier + '快递') : '快递包裹',
      trackingNumber: '',
      carrier: carrier,
      status: '待取件',
      pickupCode: pickupCode,
      expectedDate: '',
      stationName: stationName,
      stationAddress: '',
      notes: ''
    };

    const isNew = !id;

    if (id) {
      const index = parcels.findIndex(p => p.id === id);
      if (index !== -1) {
        // 编辑时保留原有的其他字段
        parcels[index] = {
          ...parcels[index],
          pickupCode: data.pickupCode,
          stationName: data.stationName,
          carrier: data.carrier,
          updatedAt: Date.now()
        };
        showToast('更新成功', 'success');
      }
    } else {
      // 新增时按取件码去重
      if (parcels.some(p => p.pickupCode === pickupCode)) {
        showToast('该取件码已存在', 'warning');
        return;
      }
      parcels.unshift({
        id: generateId(),
        ...data,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      showToast('添加成功', 'success');
    }

    saveData();
    renderAll();
    closeModal();

    // 新添加且状态为待取件时震动提醒
    if (isNew && data.status === '待取件') {
      vibrate([100, 50, 100, 50, 200]);
    }
  }

  function deleteParcel(id) {
    const parcel = parcels.find(p => p.id === id);
    if (!parcel) return;

    if (!confirm(`确定要删除「${parcel.itemName}」吗？`)) return;

    parcels = parcels.filter(p => p.id !== id);
    saveData();
    renderAll();
    showToast('已删除', 'success');
    closeDetail();
  }

  // 右滑签收
  function completeParcelBySwipe(id, cardEl) {
    const index = parcels.findIndex(p => p.id === id);
    if (index === -1) return;
    const parcel = parcels[index];
    if (parcel.status === '已取件' || parcel.status === '已签收') return;

    // 卡片滑出动画
    if (cardEl) {
      cardEl.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      cardEl.style.transform = `translateX(${cardEl.offsetWidth}px)`;
      cardEl.style.opacity = '0';
    }

    // 延迟更新数据，等动画播完
    setTimeout(() => {
      parcels[index].status = '已取件';
      parcels[index].updatedAt = Date.now();
      saveData();
      renderAll();
      vibrate([30, 20, 30]);
      showToast(`「${parcel.itemName}」已标记为已取件 ✓`, 'success');
    }, 300);
  }

  // 左滑删除
  function deleteParcelBySwipe(id, cardEl) {
    const index = parcels.findIndex(p => p.id === id);
    if (index === -1) return;
    const parcel = parcels[index];

    // 卡片滑出动画
    if (cardEl) {
      cardEl.style.transition = 'transform 0.3s ease, opacity 0.3s ease, height 0.3s ease, margin 0.3s ease, padding 0.3s ease';
      cardEl.style.transform = `translateX(-${cardEl.offsetWidth}px)`;
      cardEl.style.opacity = '0';
    }

    // 延迟更新数据，等动画播完
    setTimeout(() => {
      parcels = parcels.filter(p => p.id !== id);
      saveData();
      renderAll();
      vibrate([40]);
      showToast(`「${parcel.itemName}」已删除`, 'success');
    }, 300);
  }

  /**
   * 复制到剪贴板
   */
  function copyToClipboard(text, triggerEl) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showCopyFeedback(triggerEl);
      }).catch(() => {
        fallbackCopy(text, triggerEl);
      });
    } else {
      fallbackCopy(text, triggerEl);
    }
  }

  function fallbackCopy(text, triggerEl) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showCopyFeedback(triggerEl);
    } catch (e) {
      showToast('复制失败，请手动复制', 'error');
    }
    document.body.removeChild(textarea);
  }

  function showCopyFeedback(triggerEl) {
    if (triggerEl) {
      triggerEl.classList.add('copied');
      const originalLabel = triggerEl.querySelector('.pickup-code-label');
      if (originalLabel) {
        const originalText = originalLabel.textContent;
        originalLabel.textContent = '✅ 已复制';
        setTimeout(() => {
          triggerEl.classList.remove('copied');
          originalLabel.textContent = originalText;
        }, 1200);
      }
    }
    showToast('取件码已复制', 'success');
  }

  /**
   * 批量签收：某个驿站的所有待取件一次性标记为已取件
   */
  async function pickupAllInStation(stationName) {
    const toComplete = parcels.filter(p =>
      p.status === '待取件' &&
      getStationKey(p) === stationName
    );

    if (toComplete.length === 0) return;

    const confirmed = await showConfirmDialog(
      `确定将「${stationName}」的 ${toComplete.length} 件快递全部标记为已取件吗？`,
      { icon: '📦', okText: '全部取完' }
    );
    if (!confirmed) return;

    const now = Date.now();
    toComplete.forEach(p => {
      p.status = '已取件';
      p.updatedAt = now;
    });

    saveData();
    renderAll();
    vibrate([30, 20, 30]);
    showToast(`${stationName} 的 ${toComplete.length} 件已全部取完 ✓`, 'success');
  }

  // ===== 长按操作菜单 =====
  function showLongPressMenu(parcelId, x, y) {
    const parcel = parcels.find(p => p.id === parcelId);
    if (!parcel) return;

    // 移除已有的菜单
    hideLongPressMenu();

    const menu = document.createElement('div');
    menu.className = 'longpress-menu';
    menu.id = 'longpress-menu';

    menu.innerHTML = `
      <div class="longpress-menu-item" data-action="edit-station">
        <span>🏪</span><span>修正驿站</span>
      </div>
      <div class="longpress-menu-item" data-action="edit-carrier">
        <span>🚚</span><span>修正快递公司</span>
      </div>
      <div class="longpress-menu-item" data-action="edit">
        <span>✏️</span><span>编辑详情</span>
      </div>
      <div class="longpress-menu-item danger" data-action="delete">
        <span>🗑️</span><span>删除</span>
      </div>
    `;

    document.body.appendChild(menu);

    // 定位菜单
    const menuRect = menu.getBoundingClientRect();
    let left = x;
    let top = y + 10;

    // 防止超出右边
    if (left + menuRect.width > window.innerWidth - 10) {
      left = window.innerWidth - menuRect.width - 10;
    }
    // 防止超出下边
    if (top + menuRect.height > window.innerHeight - 10) {
      top = y - menuRect.height - 10;
    }
    // 防止超出左边
    if (left < 10) left = 10;

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // 菜单项点击
    menu.querySelectorAll('.longpress-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        hideLongPressMenu();

        if (action === 'edit-station') {
          openStationPicker(parcelId);
        } else if (action === 'edit-carrier') {
          openCarrierPicker(parcelId);
        } else if (action === 'edit') {
          openEditModal(parcelId);
        } else if (action === 'delete') {
          deleteParcel(parcelId);
        }
      });
    });

    // 点击其他地方关闭
    setTimeout(() => {
      document.addEventListener('click', hideLongPressMenu, { once: true });
    }, 10);
  }

  function hideLongPressMenu() {
    const menu = document.getElementById('longpress-menu');
    if (menu) menu.remove();
  }

  /**
   * 打开驿站选择器：用于快速修正驿站
   */
  function openStationPicker(parcelId) {
    const parcel = parcels.find(p => p.id === parcelId);
    if (!parcel) return;

    const stations = getAllRawStationNames().filter(s => s !== parcel.stationName);

    // 创建弹窗
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '2000';
    overlay.innerHTML = `
      <div class="merge-station-modal">
        <div class="merge-station-header">选择驿站</div>
        <div class="merge-station-search">
          <input type="text" id="station-picker-input" placeholder="搜索或输入新驿站名..." autofocus>
        </div>
        <div class="merge-station-list" id="station-picker-list">
          ${stations.length > 0 ? stations.map(s => `
            <div class="merge-station-option" data-name="${encodeURIComponent(s)}">
              ${escapeHtml(s)}
            </div>
          `).join('') : '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">暂无历史驿站</div>'}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 点击背景关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });

    const searchInput = overlay.querySelector('#station-picker-input');
    const listEl = overlay.querySelector('#station-picker-list');

    // 搜索过滤 + 支持输入自定义新驿站名
    searchInput.addEventListener('input', () => {
      const keyword = searchInput.value.trim();
      const keywordLow = keyword.toLowerCase();
      const filtered = stations.filter(s => s.toLowerCase().includes(keywordLow));

      // 如果输入了内容且没有匹配，显示"使用输入的内容"选项
      if (keyword && filtered.length === 0) {
        listEl.innerHTML = `
          <div class="merge-station-option" data-name="${encodeURIComponent(keyword)}" data-new="1">
            ✨ 使用新驿站：${escapeHtml(keyword)}
          </div>
        `;
      } else {
        listEl.innerHTML = filtered.map(s => `
          <div class="merge-station-option" data-name="${encodeURIComponent(s)}">
            ${escapeHtml(s)}
          </div>
        `).join('');
      }

      // 重新绑定事件
      bindPickerOptions();
    });

    function bindPickerOptions() {
      listEl.querySelectorAll('.merge-station-option').forEach(opt => {
        opt.onclick = () => {
          const newStation = decodeURIComponent(opt.dataset.name);
          const idx = parcels.findIndex(p => p.id === parcelId);
          if (idx !== -1) {
            parcels[idx].stationName = newStation;
            parcels[idx].updatedAt = Date.now();
            saveData();
            renderAll();
            showToast(`驿站已改为「${newStation}」`, 'success');
          }
          document.body.removeChild(overlay);
        };
      });
    }
    bindPickerOptions();

    setTimeout(() => searchInput.focus(), 50);
  }

  /**
   * 打开快递公司选择器
   */
  function openCarrierPicker(parcelId) {
    const parcel = parcels.find(p => p.id === parcelId);
    if (!parcel) return;

    const carriers = [
      '顺丰速运', '中通快递', '圆通速递', '申通快递', '韵达快递',
      '极兔速递', '京东物流', '邮政EMS', '百世快递', '菜鸟速递',
      '丹鸟', '德邦', '安能', '天天快递'
    ];

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '2000';
    overlay.innerHTML = `
      <div class="merge-station-modal">
        <div class="merge-station-header">选择快递公司</div>
        <div class="merge-station-list" style="max-height:300px;">
          ${carriers.map(c => `
            <div class="merge-station-option" data-name="${encodeURIComponent(c)}">
              ${c === parcel.carrier ? '✓ ' : ''}${escapeHtml(c)}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });

    overlay.querySelectorAll('.merge-station-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const newCarrier = decodeURIComponent(opt.dataset.name);
        const idx = parcels.findIndex(p => p.id === parcelId);
        if (idx !== -1) {
          parcels[idx].carrier = newCarrier;
          parcels[idx].updatedAt = Date.now();
          saveData();
          renderAll();
          showToast(`快递公司已改为「${newCarrier}」`, 'success');
        }
        document.body.removeChild(overlay);
      });
    });
  }

  // ===== 详情弹窗 =====
  function showDetail(id) {
    const p = parcels.find(p => p.id === id);
    if (!p) return;

    const daysDiff = getDaysDiff(p.expectedDate);
    let dateNote = '';
    if (p.expectedDate) {
      if (daysDiff > 0) dateNote = `（还有 ${daysDiff} 天）`;
      else if (daysDiff === 0) dateNote = `（今天）`;
      else dateNote = `（已过期 ${Math.abs(daysDiff)} 天）`;
    }

    const pickupCodeSection = p.pickupCode ? `
      <div class="detail-pickup-code">
        <div class="label">📮 取件码</div>
        <div class="code">${escapeHtml(p.pickupCode)}</div>
      </div>
    ` : '';

    const stationSection = (p.stationName || p.stationAddress) ? `
      <div class="detail-item">
        <div class="detail-label">驿站名称</div>
        <div class="detail-value">${escapeHtml(p.stationName) || '-'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">驿站地址</div>
        <div class="detail-value">${escapeHtml(p.stationAddress) || '-'}</div>
      </div>
    ` : '';

    els.detailContent.innerHTML = `
      <div style="margin-bottom:16px;">
        <h3 style="font-size:18px;margin-bottom:8px;">${escapeHtml(p.itemName)}</h3>
        <span class="status-badge status-${escapeHtml(p.status)}" style="font-size:14px;padding:6px 14px;">${escapeHtml(p.status)}</span>
      </div>

      ${pickupCodeSection}

      ${stationSection}

      <div class="detail-item">
        <div class="detail-label">快递公司</div>
        <div class="detail-value">${escapeHtml(p.carrier) || '-'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">快递单号</div>
        <div class="detail-value" style="font-family:monospace;">${escapeHtml(p.trackingNumber) || '-'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">预计到达</div>
        <div class="detail-value">${formatDate(p.expectedDate)} <span style="color:var(--muted);font-size:12px;">${dateNote}</span></div>
      </div>
      <div class="detail-item">
        <div class="detail-label">添加时间</div>
        <div class="detail-value">${formatDate(new Date(p.createdAt).toISOString().split('T')[0])}</div>
      </div>
      ${p.notes ? `
      <div class="detail-item">
        <div class="detail-label">备注</div>
        <div class="detail-value">${escapeHtml(p.notes)}</div>
      </div>
      ` : ''}

      <div class="detail-actions">
        ${p.status === '已取件' || p.status === '已签收'
          ? `<button class="btn btn-warning btn-sm" onclick="window.quickUpdateStatus('${p.id}', '待取件')">↩️ 恢复待取件</button>`
          : `<button class="btn btn-success btn-sm" onclick="window.quickUpdateStatus('${p.id}', '已取件')">✓ 标记已取件</button>`
        }
        <button class="btn btn-primary btn-sm" onclick="window.editFromDetail('${p.id}')">✏️ 编辑</button>
        <button class="btn btn-secondary btn-sm" onclick="window.deleteFromDetail('${p.id}')">🗑 删除</button>
      </div>
    `;

    els.detailOverlay.style.display = 'flex';
  }

  function closeDetail() {
    els.detailOverlay.style.display = 'none';
  }

  // 全局暴露给详情弹窗内联事件使用
  window.quickUpdateStatus = function(id, newStatus) {
    const index = parcels.findIndex(p => p.id === id);
    if (index !== -1) {
      parcels[index].status = newStatus;
      parcels[index].updatedAt = Date.now();
      saveData();
      renderAll();
      showToast(`已更新为「${newStatus}」`, 'success');
      closeDetail();
    }
  };

  window.editFromDetail = function(id) {
    closeDetail();
    setTimeout(() => openEditModal(id), 100);
  };

  window.deleteFromDetail = function(id) {
    deleteParcel(id);
  };

  // ===== 导入导出 =====
  function exportData() {
    if (parcels.length === 0) {
      showToast('暂无数据可导出', 'warning');
      return;
    }
    const dataStr = JSON.stringify(parcels, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `快递数据_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('导出成功', 'success');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        if (!Array.isArray(data)) throw new Error('格式错误');
        
        if (!confirm(`确定要导入 ${data.length} 条快递数据吗？\n这将与现有数据合并。`)) return;
        
        const existingIds = new Set(parcels.map(p => p.id));
        let added = 0;
        data.forEach(p => {
          if (p.id && !existingIds.has(p.id)) {
            // 数据迁移
            if (!p.stationName && p.location) {
              p.stationName = p.location;
              p.stationAddress = p.notes || '';
            }
            parcels.push(p);
            added++;
          }
        });
        
        saveData();
        renderAll();
        showToast(`成功导入 ${added} 条数据`, 'success');
      } catch (err) {
        showToast('导入失败：文件格式不正确', 'error');
      }
    };
    reader.readAsText(file);
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    // 添加按钮
    els.btnAdd.addEventListener('click', openAddModal);
    window.openAddModal = openAddModal;

    // 粘贴识别按钮
    if (els.btnPasteRecognize) {
      els.btnPasteRecognize.addEventListener('click', handlePasteRecognize);
    }
    // 粘贴识别输入框支持回车/Ctrl+Enter
    if (els.pasteInput) {
      els.pasteInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          handlePasteRecognize();
        }
      });
    }

    // 弹窗关闭
    els.modalClose.addEventListener('click', closeModal);
    els.btnCancel.addEventListener('click', closeModal);
    els.modalOverlay.addEventListener('click', (e) => {
      if (e.target === els.modalOverlay) closeModal();
    });

    // 详情关闭
    els.detailClose.addEventListener('click', closeDetail);
    els.detailOverlay.addEventListener('click', (e) => {
      if (e.target === els.detailOverlay) closeDetail();
    });

    // 表单提交
    els.parcelForm.addEventListener('submit', saveParcel);

    // 搜索和筛选
    let searchTimer;
    if (els.searchInput) {
      els.searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(renderParcelList, 200);
      });
    }
    if (els.filterStatus) {
      els.filterStatus.addEventListener('change', renderParcelList);
    }
    if (els.sortBy) {
      els.sortBy.addEventListener('change', renderParcelList);
    }
    if (els.btnStationManage) {
      els.btnStationManage.addEventListener('click', () => {
        openStationManagePopup();
      });
    }

    // 驿站列表事件委托
    els.stationList.addEventListener('click', (e) => {
      // 收起/展开已取件分组
      const toggleBtn = e.target.closest('[data-action="toggle-completed"]');
      if (toggleBtn) {
        const group = toggleBtn.closest('.parcel-group-completed');
        const content = group.querySelector('.parcel-group-content');
        const isCollapsed = content.style.display === 'none';
        content.style.display = isCollapsed ? '' : 'none';
        toggleBtn.textContent = isCollapsed ? '收起' : '展开';
        return;
      }

      // 批量签收按钮（在驿站卡片底部，不在包裹卡片内）
      const pickupAllBtn = e.target.closest('[data-action="pickup-all"]');
      if (pickupAllBtn) {
        e.stopPropagation();
        const stationName = decodeURIComponent(pickupAllBtn.dataset.station);
        pickupAllInStation(stationName);
        return;
      }

      const card = e.target.closest('.parcel-card');
      if (!card) return;
      const id = card.dataset.id;

      // 如果是滑动过的卡片，点击先复位，不触发详情
      if (card.classList.contains('swiped')) {
        resetSwipe(card);
        return;
      }

      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        if (action === 'view') showDetail(id);
        else if (action === 'edit') openEditModal(id);
        else if (action === 'delete') deleteParcel(id);
        else if (action === 'copy-code') {
          const code = actionBtn.dataset.code;
          copyToClipboard(code, actionBtn);
        }
        return;
      }

      // 点击卡片查看详情
      showDetail(id);
    });

    // 右滑手势 - 触屏
    let swipeStartX = 0, swipeStartY = 0, swipingCard = null, isSwiping = false, swipeMoved = false;
    let longPressTimer = null, longPressTriggered = false;

    function onSwipeStart(e, x, y) {
      const card = e.target.closest('.parcel-card');
      if (!card) return;
      swipingCard = card;
      swipeStartX = x;
      swipeStartY = y;
      isSwiping = true;
      swipeMoved = false;
      longPressTriggered = false;
      card.classList.add('swiping');

      // 启动长按计时器（500ms）
      longPressTimer = setTimeout(() => {
        if (!swipeMoved && isSwiping) {
          longPressTriggered = true;
          const id = card.dataset.id;
          showLongPressMenu(id, x, y);
          // 震动一下表示触发了长按
          vibrate([20]);
        }
      }, 500);
    }

    function onSwipeMove(e, x, y) {
      if (!isSwiping || !swipingCard) return;
      const dx = x - swipeStartX;
      const dy = y - swipeStartY;

      // 如果移动距离超过阈值，取消长按
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }

      // 如果长按已经触发，不处理滑动
      if (longPressTriggered) return;

      // 判断是否水平滑动为主
      if (!swipeMoved && Math.abs(dx) > 8) {
        swipeMoved = true;
        if (Math.abs(dy) > Math.abs(dx)) {
          // 垂直滑动，取消
          isSwiping = false;
          swipingCard.classList.remove('swiping');
          swipingCard = null;
          return;
        }
      }

      if (swipeMoved) {
        e.preventDefault && e.preventDefault();
        const cardWidth = swipingCard.offsetWidth;
        // 限制滑动范围：向右最多60%（签收），向左最多60%（删除）
        const translateX = Math.max(-cardWidth * 0.6, Math.min(dx, cardWidth * 0.6));
        const content = swipingCard.querySelector('.parcel-content');
        if (content) content.style.transform = `translateX(${translateX}px)`;

        // 更新背景提示
        const bgLeft = swipingCard.querySelector('.swipe-bg-left');
        const bgRight = swipingCard.querySelector('.swipe-bg-right');
        const threshold = cardWidth * 0.3;

        if (translateX > 0) {
          // 右滑 - 签收
          if (bgLeft) bgLeft.style.opacity = Math.min(1, Math.abs(translateX) / threshold);
          if (bgRight) bgRight.style.opacity = '0';
          if (bgLeft) {
            if (translateX > threshold) {
              bgLeft.classList.add('ready');
            } else {
              bgLeft.classList.remove('ready');
            }
          }
        } else if (translateX < 0) {
          // 左滑 - 删除
          if (bgRight) bgRight.style.opacity = Math.min(1, Math.abs(translateX) / threshold);
          if (bgLeft) bgLeft.style.opacity = '0';
          if (bgRight) {
            if (Math.abs(translateX) > threshold) {
              bgRight.classList.add('ready');
            } else {
              bgRight.classList.remove('ready');
            }
          }
        }
      }
    }

    function onSwipeEnd(e, x) {
      if (!isSwiping || !swipingCard) return;

      // 清理长按计时器
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      // 如果长按触发了，不处理滑动
      if (longPressTriggered) {
        isSwiping = false;
        swipingCard = null;
        return;
      }

      const card = swipingCard;
      const dx = x - swipeStartX;
      const threshold = card.offsetWidth * 0.3;

      if (dx > threshold && swipeMoved) {
        // 右滑成功 - 标记已取件
        const id = card.dataset.id;
        completeParcelBySwipe(id, card);
      } else if (dx < -threshold && swipeMoved) {
        // 左滑成功 - 删除
        const id = card.dataset.id;
        deleteParcelBySwipe(id, card);
      } else {
        // 回弹
        resetSwipe(card);
      }

      isSwiping = false;
      swipingCard = null;
    }

    // 导入导出

    function resetSwipe(card) {
      const content = card.querySelector('.parcel-content');
      if (content) content.style.transform = '';
      card.classList.remove('swiping', 'swiped');
      const bgLeft = card.querySelector('.swipe-bg-left');
      const bgRight = card.querySelector('.swipe-bg-right');
      if (bgLeft) {
        bgLeft.classList.remove('ready');
        bgLeft.style.opacity = '';
      }
      if (bgRight) {
        bgRight.classList.remove('ready');
        bgRight.style.opacity = '';
      }
    }

    // 触屏事件
    els.stationList.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      onSwipeStart(e, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    els.stationList.addEventListener('touchmove', (e) => {
      if (!isSwiping || !swipingCard) return;
      if (e.touches.length !== 1) return;
      onSwipeMove(e, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    els.stationList.addEventListener('touchend', (e) => {
      if (!isSwiping || !swipingCard) return;
      const touch = e.changedTouches[0];
      onSwipeEnd(e, touch.clientX);
    });

    // 鼠标事件（桌面端调试用）
    let mouseDown = false;
    els.stationList.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      mouseDown = true;
      onSwipeStart(e, e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', (e) => {
      if (!mouseDown) return;
      onSwipeMove(e, e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', (e) => {
      if (!mouseDown) return;
      mouseDown = false;
      onSwipeEnd(e, e.clientX);
    });

    // 导入导出
    els.btnExport.addEventListener('click', exportData);
    if (els.btnImport && els.fileImport) {
      els.btnImport.addEventListener('click', () => els.fileImport.click());
      els.fileImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importData(file);
        e.target.value = '';
      });
    }

    // ESC 关闭弹窗
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (els.modalOverlay.style.display === 'flex') closeModal();
        if (els.detailOverlay.style.display === 'flex') closeDetail();
        if (document.getElementById('settings-modal').style.display === 'flex') closeSettingsModal();
      }
    });

    // 设置弹窗
    const btnSettings = document.getElementById('btn-settings');
    if (btnSettings) btnSettings.addEventListener('click', openSettingsModal);
    const settingsClose = document.getElementById('settings-close');
    if (settingsClose) settingsClose.addEventListener('click', closeSettingsModal);
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
      settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
      });
    }

    // 驿站管理弹窗
    const stationManageClose = document.getElementById('station-manage-close');
    if (stationManageClose) stationManageClose.addEventListener('click', closeStationManagePopup);
    const stationManageModal = document.getElementById('station-manage-modal');
    if (stationManageModal) {
      stationManageModal.addEventListener('click', (e) => {
        if (e.target === stationManageModal) closeStationManagePopup();
      });
    }

    // 震动开关
    const vibrationToggle = document.getElementById('vibration-toggle');
    if (vibrationToggle) {
      vibrationToggle.addEventListener('change', (e) => {
        settings.vibration = e.target.checked;
        saveSettings();
        if (settings.vibration) {
          vibrate([50, 30, 50]);
          showToast('震动提醒已开启', 'success');
        } else {
          showToast('震动提醒已关闭', 'success');
        }
      });
    }

    // 新快递待确认开关
    const pendingConfirmToggle = document.getElementById('pending-confirm-toggle');
    if (pendingConfirmToggle) {
      pendingConfirmToggle.addEventListener('change', (e) => {
        settings.pendingConfirmEnabled = e.target.checked;
        saveSettings();
        if (settings.pendingConfirmEnabled) {
          showToast('已开启：新快递先待确认', 'success');
        } else {
          if (pendingParcels.length > 0) {
            if (confirm('关闭后，当前待确认的快递会直接入库，确定继续吗？')) {
              pendingParcels.forEach(p => parcels.unshift(p));
              pendingParcels = [];
              saveData();
              savePendingParcels();
              renderAll();
            } else {
              e.target.checked = true;
              settings.pendingConfirmEnabled = true;
              return;
            }
          }
          showToast('已关闭：新快递直接入库', 'success');
        }
        renderPendingConfirmBar();
      });
    }

    // 待确认快递提示条 - 全部确认
    const btnPendingConfirmAll = document.getElementById('btn-pending-confirm-all');
    if (btnPendingConfirmAll) {
      btnPendingConfirmAll.addEventListener('click', confirmAllPending);
    }
    // 待确认快递提示条 - 查看
    const btnPendingConfirmView = document.getElementById('btn-pending-confirm-view');
    if (btnPendingConfirmView) {
      btnPendingConfirmView.addEventListener('click', openPendingListModal);
    }

    // 模拟测试 - 短信
    const btnMockSms = document.getElementById('btn-mock-sms');
    if (btnMockSms) {
      btnMockSms.addEventListener('click', () => {
        window.onSmsReceived({
          isExpress: true,
          sender: "10690000710855",
          content: "【菜鸟驿站】您的包裹已到站，凭14-2-0117到杭州余杭福鼎家园晓风苑6-5店取件。详询4001787878",
          pickupCode: "14-2-0117",
          stationName: "杭州余杭福鼎家园晓风苑6-5店",
          carrier: "菜鸟驿站",
          status: "待取件",
          source: "sms"
        });
      });
    }
    // 模拟测试 - 拼多多通知
    const btnMockNotification = document.getElementById('btn-mock-notification');
    if (btnMockNotification) {
      btnMockNotification.addEventListener('click', () => {
        window.onSmsReceived({
          isExpress: true,
          content: "您的圆通快递已存入福鼎家园东门7-1顺丰驿站，取件码：10-5-9936，请及时领取~",
          pickupCode: "10-5-9936",
          stationName: "福鼎家园东门7-1顺丰驿站",
          carrier: "圆通",
          status: "待取件",
          source: "notification",
          sourceApp: "com.xunmeng.pinduoduo"
        });
      });
    }
    // 模拟测试 - 小红书通知
    const btnMockXhs = document.getElementById('btn-mock-xhs');
    if (btnMockXhs) {
      btnMockXhs.addEventListener('click', () => {
        window.onSmsReceived({
          isExpress: true,
          content: "【申通快递】您的772077836834709包裹已存放福鼎家园晓风苑31-5喵站，取件码9-3-4709，请及时领取",
          pickupCode: "9-3-4709",
          stationName: "福鼎家园晓风苑31-5喵站",
          carrier: "申通快递",
          status: "待取件",
          source: "notification",
          sourceApp: "com.xingin.xhs"
        });
      });
    }

    // 自动清理开关
    const autoCleanToggle = document.getElementById('auto-clean-toggle');
    if (autoCleanToggle) {
      autoCleanToggle.addEventListener('change', (e) => {
        settings.autoClean = e.target.checked;
        saveSettings();
        updateRetentionDaysOpacity();
        if (settings.autoClean) {
          showToast('已开启自动清理', 'success');
          runAutoClean();
        } else {
          showToast('已关闭自动清理', 'success');
        }
      });
    }

    // 保留天数
    const retentionDays = document.getElementById('retention-days');
    if (retentionDays) {
      retentionDays.addEventListener('change', (e) => {
        settings.retentionDays = parseInt(e.target.value);
        saveSettings();
        updateRetentionDesc();
      });
    }

    // 清理按钮
    const btnCleanExpired = document.getElementById('btn-clean-expired');
    if (btnCleanExpired) btnCleanExpired.addEventListener('click', cleanExpired);
    const btnCleanCompleted = document.getElementById('btn-clean-completed');
    if (btnCleanCompleted) btnCleanCompleted.addEventListener('click', cleanCompleted);
    const btnCleanAll = document.getElementById('btn-clean-all');
    if (btnCleanAll) btnCleanAll.addEventListener('click', cleanAll);

    // 设置里的导入导出
    const btnSettingsExport = document.getElementById('btn-settings-export');
    if (btnSettingsExport) btnSettingsExport.addEventListener('click', exportData);
    const btnSettingsImport = document.getElementById('btn-settings-import');
    if (btnSettingsImport) btnSettingsImport.addEventListener('click', () => els.fileImport.click());

    // 已取件列表点击查看详情
    if (els.completedList) {
      els.completedList.addEventListener('click', (e) => {
        const item = e.target.closest('.completed-item');
        if (!item) return;
        const id = item.dataset.id;
        if (id) showDetail(id);
      });
    }

    // 权限管理事件
    bindPermissionEvents();

    // 监听APP全选/全不选
    const btnSelectAll = document.getElementById('btn-monitor-select-all');
    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', () => setAllMonitorApps(true));
    }
    const btnClearAll = document.getElementById('btn-monitor-clear-all');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', () => setAllMonitorApps(false));
    }

    // 监听APP折叠面板
    const monitorCollapseBtn = document.getElementById('monitor-collapse-btn');
    if (monitorCollapseBtn) {
      monitorCollapseBtn.addEventListener('click', () => {
        const content = document.getElementById('monitor-collapse-content');
        if (content) {
          const isExpanded = content.classList.contains('expanded');
          if (isExpanded) {
            content.classList.remove('expanded');
            monitorCollapseBtn.classList.add('collapsed');
          } else {
            content.classList.add('expanded');
            monitorCollapseBtn.classList.remove('collapsed');
          }
        }
      });
    }

    // 模拟测试折叠面板
    const mockCollapseBtn = document.getElementById('mock-collapse-btn');
    if (mockCollapseBtn) {
      mockCollapseBtn.addEventListener('click', () => {
        const content = document.getElementById('mock-collapse-content');
        if (content) {
          const isExpanded = content.classList.contains('expanded');
          if (isExpanded) {
            content.classList.remove('expanded');
            mockCollapseBtn.classList.add('collapsed');
          } else {
            content.classList.add('expanded');
            mockCollapseBtn.classList.remove('collapsed');
          }
        }
      });
    }

    // 使用说明弹窗
    const btnUsageGuide = document.getElementById('btn-usage-guide');
    if (btnUsageGuide) {
      btnUsageGuide.addEventListener('click', () => {
        document.getElementById('usage-modal').style.display = 'flex';
      });
    }
    const usageClose = document.getElementById('usage-close');
    if (usageClose) {
      usageClose.addEventListener('click', () => {
        document.getElementById('usage-modal').style.display = 'none';
      });
    }
    const usageModal = document.getElementById('usage-modal');
    if (usageModal) {
      usageModal.addEventListener('click', (e) => {
        if (e.target === usageModal) {
          usageModal.style.display = 'none';
        }
      });
    }

    // 更新相关事件
    const btnCheckUpdate = document.getElementById('btn-check-update');
    if (btnCheckUpdate) {
      btnCheckUpdate.addEventListener('click', () => checkUpdate(true));
    }

    const btnEditUpdateUrl = document.getElementById('btn-edit-update-url');
    if (btnEditUpdateUrl) {
      btnEditUpdateUrl.addEventListener('click', openUpdateUrlModal);
    }

    const btnUpdateCancel = document.getElementById('btn-update-cancel');
    if (btnUpdateCancel) btnUpdateCancel.addEventListener('click', closeUpdateModal);

    const btnUpdateNow = document.getElementById('btn-update-now');
    if (btnUpdateNow) btnUpdateNow.addEventListener('click', doUpdate);

    const updateModal = document.getElementById('update-modal');
    if (updateModal) {
      updateModal.addEventListener('click', (e) => {
        if (e.target === updateModal) closeUpdateModal();
      });
    }

    // 更新地址弹窗
    const updateUrlClose = document.getElementById('update-url-close');
    if (updateUrlClose) updateUrlClose.addEventListener('click', closeUpdateUrlModal);
    const btnUpdateUrlCancel = document.getElementById('btn-update-url-cancel');
    if (btnUpdateUrlCancel) btnUpdateUrlCancel.addEventListener('click', closeUpdateUrlModal);
    const btnUpdateUrlSave = document.getElementById('btn-update-url-save');
    if (btnUpdateUrlSave) btnUpdateUrlSave.addEventListener('click', saveUpdateUrl);
    const updateUrlModal = document.getElementById('update-url-modal');
    if (updateUrlModal) {
      updateUrlModal.addEventListener('click', (e) => {
        if (e.target === updateUrlModal) closeUpdateUrlModal();
      });
    }
  }

  // ===== 版本更新 =====
  let currentVersionName = '1.0.0';
  let currentVersionCode = 1;
  let latestUpdateInfo = null;
  let updateDownloaded = false; // 是否已下载完成（用于直接安装）

  // 初始化版本信息
  function initVersionInfo() {
    if (window.AndroidBridge && typeof window.AndroidBridge.getVersionName === 'function') {
      try {
        currentVersionName = window.AndroidBridge.getVersionName();
        currentVersionCode = window.AndroidBridge.getVersionCode();
      } catch (e) {
        console.error('获取版本信息失败:', e);
      }
    }
    const versionEl = document.getElementById('about-version');
    if (versionEl) {
      versionEl.textContent = '版本 ' + currentVersionName;
    }
  }

  // 检查更新
  function checkUpdate(showNoUpdateTip) {
    if (!settings.updateUrl || !settings.updateUrl.trim()) {
      if (showNoUpdateTip) {
        showToast('请先设置更新地址', 'warning');
      }
      return;
    }

    const btn = document.getElementById('btn-check-update');
    const desc = document.getElementById('check-update-desc');
    if (btn) {
      btn.textContent = '检查中...';
      btn.disabled = true;
    }

    fetch(settings.updateUrl.trim(), { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (btn) {
          btn.textContent = '检查';
          btn.disabled = false;
        }

        if (!data || !data.versionCode) {
          if (showNoUpdateTip) showToast('版本信息格式错误', 'error');
          return;
        }

        const remoteVersionCode = parseInt(data.versionCode) || 0;
        latestUpdateInfo = data;

        if (remoteVersionCode > currentVersionCode) {
          // 有新版本
          if (desc) desc.textContent = '发现新版本 ' + (data.versionName || '');
          showUpdateModal(data);
        } else {
          if (desc) desc.textContent = '已是最新版本';
          if (showNoUpdateTip) showToast('已是最新版本', 'success');
        }

        // 记录检查时间
        settings.lastUpdateCheck = Date.now();
        saveSettings();
      })
      .catch(err => {
        console.error('检查更新失败:', err);
        if (btn) {
          btn.textContent = '检查';
          btn.disabled = false;
        }
        if (desc) desc.textContent = '检查失败，请检查网络';
        if (showNoUpdateTip) showToast('检查更新失败', 'error');
      });
  }

  // 显示更新弹窗
  function showUpdateModal(data) {
    const modal = document.getElementById('update-modal');
    if (!modal) return;

    document.getElementById('new-version-name').textContent = data.versionName || '新版本';
    document.getElementById('current-version-name').textContent = currentVersionName;
    document.getElementById('update-changelog').textContent = data.changelog || '暂无更新说明';

    // 重置下载状态
    updateDownloaded = false;
    const btnUpdate = document.getElementById('btn-update-now');
    if (btnUpdate) {
      btnUpdate.textContent = '立即更新';
      btnUpdate.disabled = false;
    }
    const progressWrap = document.getElementById('update-progress-wrap');
    if (progressWrap) progressWrap.style.display = 'none';
    const progressFill = document.getElementById('update-progress-fill');
    if (progressFill) progressFill.style.width = '0%';
    const progressText = document.getElementById('update-progress-text');
    if (progressText) progressText.textContent = '0%';

    modal.style.display = 'flex';
  }

  function closeUpdateModal() {
    const modal = document.getElementById('update-modal');
    if (modal) modal.style.display = 'none';
  }

  // 立即更新
  function doUpdate() {
    if (!latestUpdateInfo || !latestUpdateInfo.apkUrl) {
      showToast('下载地址无效', 'error');
      return;
    }

    if (window.AndroidBridge && typeof window.AndroidBridge.downloadUpdate === 'function') {
      // 如果已经下载完成了，直接安装
      if (updateDownloaded && typeof window.AndroidBridge.installDownloadedApk === 'function') {
        window.AndroidBridge.installDownloadedApk();
        return;
      }

      // APP内下载，显示进度条
      const progressWrap = document.getElementById('update-progress-wrap');
      const btnUpdate = document.getElementById('btn-update-now');
      if (progressWrap) progressWrap.style.display = 'block';
      if (btnUpdate) {
        btnUpdate.textContent = '下载中...';
        btnUpdate.disabled = true;
      }
      // 优先使用多地址列表，降级到单地址
      const urls = latestUpdateInfo.apkUrls && latestUpdateInfo.apkUrls.length > 0
        ? JSON.stringify(latestUpdateInfo.apkUrls)
        : latestUpdateInfo.apkUrl;
      window.AndroidBridge.downloadUpdate(urls);
    } else {
      // 网页版直接跳转
      window.open(latestUpdateInfo.apkUrl, '_blank');
      closeUpdateModal();
    }
  }

  // 下载进度回调（由原生层调用）
  window.onDownloadProgress = function(progress, done, failed) {
    const progressFill = document.getElementById('update-progress-fill');
    const progressText = document.getElementById('update-progress-text');
    const btnUpdate = document.getElementById('btn-update-now');

    if (progressFill) progressFill.style.width = progress + '%';
    if (progressText) progressText.textContent = progress + '%';

    if (done) {
      // 下载完成，按钮变成"安装"，可以点击重试
      if (btnUpdate) {
        btnUpdate.textContent = '安装';
        btnUpdate.disabled = false;
      }
      // 标记已下载完成，下次点击直接安装
      updateDownloaded = true;
    } else if (failed) {
      showToast('下载失败', 'error');
      if (btnUpdate) {
        btnUpdate.textContent = '立即更新';
        btnUpdate.disabled = false;
      }
      const progressWrap = document.getElementById('update-progress-wrap');
      if (progressWrap) progressWrap.style.display = 'none';
      updateDownloaded = false;
    }
  };

  // 启动时自动检查更新（每24小时最多自动检查一次）
  function autoCheckUpdate() {
    if (!settings.updateUrl || !settings.updateUrl.trim()) return;

    // 每次启动都检查更新，有更新就弹窗提示
    setTimeout(() => {
      checkUpdate(false); // 不显示"已是最新"的提示，有更新会自动弹窗
    }, 1500); // 延迟1.5秒，不影响启动速度
  }

  // 更新地址设置
  function openUpdateUrlModal() {
    const modal = document.getElementById('update-url-modal');
    const input = document.getElementById('update-url-input');
    if (input) input.value = settings.updateUrl || '';
    if (modal) modal.style.display = 'flex';
  }

  function closeUpdateUrlModal() {
    const modal = document.getElementById('update-url-modal');
    if (modal) modal.style.display = 'none';
  }

  function saveUpdateUrl() {
    const input = document.getElementById('update-url-input');
    if (input) {
      settings.updateUrl = input.value.trim();
      saveSettings();
      showToast('更新地址已保存', 'success');
    }
    closeUpdateUrlModal();
  }

  // ===== 启动 =====
  function init() {
    initEls();
    loadData();
    initVersionInfo();
    bindEvents();
    renderAll();
    runAutoClean();
    // 启动时同步监听配置到原生层
    syncMonitorAppsToNative();
    autoCheckUpdate();
  }

  // ===== 自动清理 =====
  function runAutoClean() {
    if (!settings.autoClean) return;
    const days = settings.retentionDays || 7;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const beforeCount = parcels.length;
    parcels = parcels.filter(p => {
      if (p.status !== '已取件' && p.status !== '已签收') return true;
      const checkTime = p.updatedAt || p.createdAt;
      return checkTime > cutoff;
    });
    const removed = beforeCount - parcels.length;
    if (removed > 0) {
      saveData();
      console.log(`自动清理了 ${removed} 条超期已完成快递`);
    }
  }

  // ===== 权限管理 =====
  function updatePermissionStatus() {
    const permSection = document.getElementById('permission-section');
    if (!permSection) return;

    // 只有 APP 环境才显示权限管理
    if (!window.AndroidBridge) {
      permSection.style.display = 'none';
      return;
    }
    permSection.style.display = 'block';

    try {
      // 短信权限状态
      const smsGranted = window.AndroidBridge.isSmsPermissionGranted();
      const smsDesc = document.getElementById('sms-perm-desc');
      const smsBtn = document.getElementById('btn-sms-perm');
      const smsCard = smsBtn ? smsBtn.closest('.permission-card') : null;

      if (smsGranted) {
        if (smsDesc) smsDesc.textContent = '✓ 已开启，可自动识别快递取件码短信';
        if (smsBtn) {
          smsBtn.textContent = '已开启';
          smsBtn.className = 'btn btn-success btn-sm';
          smsBtn.disabled = true;
        }
        if (smsCard) smsCard.classList.add('granted');
      } else {
        if (smsDesc) smsDesc.textContent = '用于自动识别快递取件码短信（未开启）';
        if (smsBtn) {
          smsBtn.textContent = '去开启';
          smsBtn.className = 'btn btn-primary btn-sm';
          smsBtn.disabled = false;
        }
        if (smsCard) smsCard.classList.remove('granted');
      }

      // 通知监听权限状态
      const notifyGranted = window.AndroidBridge.isNotificationListenerEnabled();
      const notifyDesc = document.getElementById('notify-perm-desc');
      const notifyBtn = document.getElementById('btn-notify-perm');
      const notifyCard = notifyBtn ? notifyBtn.closest('.permission-card') : null;

      if (notifyGranted) {
        if (notifyDesc) notifyDesc.textContent = '✓ 已开启，可从淘宝/拼多多/小红书等APP提取取件码';
        if (notifyBtn) {
          notifyBtn.textContent = '已开启';
          notifyBtn.className = 'btn btn-success btn-sm';
          notifyBtn.disabled = true;
        }
        if (notifyCard) notifyCard.classList.add('granted');
      } else {
        if (notifyDesc) notifyDesc.textContent = '用于从淘宝/拼多多/小红书等APP通知中提取取件码（未开启）';
        if (notifyBtn) {
          notifyBtn.textContent = '去开启';
          notifyBtn.className = 'btn btn-primary btn-sm';
          notifyBtn.disabled = false;
        }
        if (notifyCard) notifyCard.classList.remove('granted');
      }
    } catch (e) {
      console.error('检查权限状态失败:', e);
    }
  }

  function bindPermissionEvents() {
    const smsBtn = document.getElementById('btn-sms-perm');
    if (smsBtn) {
      smsBtn.addEventListener('click', () => {
        if (window.AndroidBridge && window.AndroidBridge.requestSmsPermission) {
          window.AndroidBridge.requestSmsPermission();
          // 延迟一秒后刷新状态
          setTimeout(updatePermissionStatus, 1500);
        }
      });
    }

    const notifyBtn = document.getElementById('btn-notify-perm');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', () => {
        if (window.AndroidBridge && window.AndroidBridge.openNotificationListenerSettings) {
          window.AndroidBridge.openNotificationListenerSettings();
          // 用户从设置返回后刷新状态（用定时器轮询几次）
          let checks = 0;
          const checkInterval = setInterval(() => {
            checks++;
            updatePermissionStatus();
            if (checks >= 10) clearInterval(checkInterval);
          }, 1000);
        }
      });
    }
  }

  // ===== 监听APP管理 =====
  function renderMonitorAppList() {
    const listEl = document.getElementById('monitor-app-list');
    if (!listEl) return;

    // 只有APP环境才显示
    if (!window.AndroidBridge) {
      const section = document.getElementById('monitor-section');
      if (section) section.style.display = 'none';
      return;
    }

    const section = document.getElementById('monitor-section');
    if (section) section.style.display = 'block';

    // 按类别分组
    const shopping = SUPPORTED_MONITOR_APPS.filter(a => a.category === 'shopping');
    const express = SUPPORTED_MONITOR_APPS.filter(a => a.category === 'express');

    let html = '';
    html += '<div class="monitor-category">购物平台</div>';
    shopping.forEach(app => {
      const checked = settings.monitorApps && settings.monitorApps[app.pkg] ? 'checked' : '';
      html += `
        <div class="monitor-app-item" data-pkg="${app.pkg}">
          <div class="monitor-app-info">
            <div class="monitor-app-icon">${app.icon}</div>
            <div>
              <div class="monitor-app-name">${app.name}</div>
              <div class="monitor-app-desc">${app.desc}</div>
            </div>
          </div>
          <label class="switch">
            <input type="checkbox" class="monitor-app-toggle" data-pkg="${app.pkg}" ${checked}>
            <span class="slider"></span>
          </label>
        </div>
      `;
    });

    html += '<div class="monitor-category">快递APP</div>';
    express.forEach(app => {
      const checked = settings.monitorApps && settings.monitorApps[app.pkg] ? 'checked' : '';
      html += `
        <div class="monitor-app-item" data-pkg="${app.pkg}">
          <div class="monitor-app-info">
            <div class="monitor-app-icon">${app.icon}</div>
            <div>
              <div class="monitor-app-name">${app.name}</div>
              <div class="monitor-app-desc">${app.desc}</div>
            </div>
          </div>
          <label class="switch">
            <input type="checkbox" class="monitor-app-toggle" data-pkg="${app.pkg}" ${checked}>
            <span class="slider"></span>
          </label>
        </div>
      `;
    });

    listEl.innerHTML = html;

    // 更新已选数量
    updateMonitorSelectedCount();

    // 绑定开关事件
    listEl.querySelectorAll('.monitor-app-toggle').forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        const pkg = e.target.dataset.pkg;
        if (!settings.monitorApps) settings.monitorApps = {};
        settings.monitorApps[pkg] = e.target.checked;
        saveSettings();
        syncMonitorAppsToNative();
        updateMonitorSelectedCount();

        if (e.target.checked) {
          showToast(`已开启 ${getAppNameByPkg(pkg)} 监听`, 'success');
        } else {
          showToast(`已关闭 ${getAppNameByPkg(pkg)} 监听`, 'info');
        }
      });
    });
  }

  function updateMonitorSelectedCount() {
    const countEl = document.getElementById('monitor-selected-count');
    if (!countEl || !settings.monitorApps) {
      if (countEl) countEl.textContent = '已选 0 个';
      return;
    }
    const count = Object.values(settings.monitorApps).filter(Boolean).length;
    countEl.textContent = `已选 ${count} 个`;
  }

  function getAppNameByPkg(pkg) {
    const app = SUPPORTED_MONITOR_APPS.find(a => a.pkg === pkg);
    return app ? app.name : pkg;
  }

  // 把监听配置同步到原生层（通知服务需要读取）
  function syncMonitorAppsToNative() {
    if (!window.AndroidBridge || !settings.monitorApps) return;
    try {
      if (typeof window.AndroidBridge.setMonitorApps === 'function') {
        window.AndroidBridge.setMonitorApps(JSON.stringify(settings.monitorApps));
      }
    } catch (e) {
      console.error('同步监听配置失败:', e);
    }
  }

  // 全选/全不选
  function setAllMonitorApps(checked) {
    if (!settings.monitorApps) settings.monitorApps = {};
    SUPPORTED_MONITOR_APPS.forEach(app => {
      settings.monitorApps[app.pkg] = checked;
    });
    saveSettings();
    syncMonitorAppsToNative();
    renderMonitorAppList();
    showToast(checked ? '已全选' : '已全部取消', 'success');
  }

  // ===== 驿站管理弹窗 =====
  /**
   * 打开驿站管理弹窗
   */
  function openStationManagePopup() {
    const modal = document.getElementById('station-manage-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    renderStationManagePopupList();
  }

  /**
   * 关闭驿站管理弹窗
   */
  function closeStationManagePopup() {
    const modal = document.getElementById('station-manage-modal');
    if (modal) modal.style.display = 'none';
  }

  /**
   * 渲染驿站管理弹窗里的列表
   */
  function renderStationManagePopupList() {
    const listEl = document.getElementById('station-manage-popup-list');
    const emptyEl = document.getElementById('station-manage-popup-empty');
    if (!listEl) return;

    const allStations = getAllStationsWithCount();
    const visibleStations = allStations.filter(s =>
      !settings.hiddenStations || !settings.hiddenStations.includes(s.name));
    const hiddenStations = allStations.filter(s =>
      settings.hiddenStations && settings.hiddenStations.includes(s.name));

    if (allStations.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    let html = '';

    // 显示中的驿站
    if (visibleStations.length > 0) {
      html += `<div class="station-manage-section-title">显示中的驿站（${visibleStations.length}）</div>`;
      html += visibleStations.map(s => {
        const aliasHtml = s.aliases.length > 0
          ? `<div class="station-manage-alias">包含：${s.aliases.join('、')}</div>`
          : '';
        return `
          <div class="station-manage-item">
            <div class="station-manage-info">
              <div class="station-manage-name">🏪 ${escapeHtml(s.name)}</div>
              <div class="station-manage-meta">共 ${s.count} 个包裹 · 待取 ${s.pickupCount} 件</div>
              ${aliasHtml}
            </div>
            <div class="station-manage-actions">
              <button class="station-manage-btn" data-action="popup-merge" data-name="${encodeURIComponent(s.name)}">
                合并
              </button>
              <button class="station-manage-btn btn-warn" data-action="popup-hide" data-name="${encodeURIComponent(s.name)}">
                隐藏
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    // 已隐藏的驿站
    if (hiddenStations.length > 0) {
      html += `<div class="station-manage-section-title">已隐藏的驿站（${hiddenStations.length}）</div>`;
      html += hiddenStations.map(s => {
        const aliasHtml = s.aliases.length > 0
          ? `<div class="station-manage-alias">包含：${s.aliases.join('、')}</div>`
          : '';
        return `
          <div class="station-manage-item station-hidden-item">
            <div class="station-manage-info">
              <div class="station-manage-name">🏪 ${escapeHtml(s.name)}</div>
              <div class="station-manage-meta">共 ${s.count} 个包裹 · 待取 ${s.pickupCount} 件</div>
              ${aliasHtml}
            </div>
            <div class="station-manage-actions">
              <button class="station-manage-btn btn-primary" data-action="popup-unhide" data-name="${encodeURIComponent(s.name)}">
                恢复显示
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    listEl.innerHTML = html;

    // 绑定合并按钮
    listEl.querySelectorAll('[data-action="popup-merge"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const stationName = decodeURIComponent(btn.dataset.name);
        openMergeStationModal(stationName, 'popup');
      });
    });

    // 绑定隐藏按钮
    listEl.querySelectorAll('[data-action="popup-hide"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const stationName = decodeURIComponent(btn.dataset.name);
        const station = allStations.find(s => s.name === stationName);
        const pendingCount = station ? station.pickupCount || 0 : 0;

        // 只有待取件 > 0 时才弹二次确认
        if (pendingCount > 0) {
          const confirmed = await showConfirmDialog(
            `该驿站还有 ${pendingCount} 个待取件！\n确定要隐藏吗？\n（数据不会删除，下次收到新快递时会自动恢复）`,
            { icon: '⚠️', okText: '隐藏' }
          );
          if (!confirmed) return;
        }

        if (!settings.hiddenStations) settings.hiddenStations = [];
        if (!settings.hiddenStations.includes(stationName)) {
          settings.hiddenStations.push(stationName);
        }
        saveSettings();
        renderStationManagePopupList();
        renderAll();
        showToast('已隐藏', 'success');
      });
    });

    // 绑定恢复按钮
    listEl.querySelectorAll('[data-action="popup-unhide"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const stationName = decodeURIComponent(btn.dataset.name);
        unhideStation(stationName);
        renderStationManagePopupList();
      });
    });
  }

  /**
   * 取消隐藏驿站（恢复显示）
   */
  function unhideStation(stationName) {
    if (!settings.hiddenStations) return;
    const idx = settings.hiddenStations.indexOf(stationName);
    if (idx === -1) return;
    settings.hiddenStations.splice(idx, 1);
    saveSettings();
    renderStationManageList();
    renderAll();
    showToast(`已恢复「${stationName}」`, 'success');
  }

  // ===== 驿站管理 =====
  /**
   * 获取所有驿站及其包裹数量（应用别名映射后）
   */
  function getAllStationsWithCount() {
    const stationMap = {};
    parcels.forEach(p => {
      const key = getStationKey(p);
      if (!stationMap[key]) {
        stationMap[key] = {
          name: getStationName(p),
          count: 0,
          pickupCount: 0,
          completedCount: 0,
          aliases: [] // 被合并进来的别名
        };
      }
      stationMap[key].count++;
      if (p.status === '待取件') stationMap[key].pickupCount++;
      if (p.status === '已取件' || p.status === '已签收') stationMap[key].completedCount++;
    });

    // 找出哪些别名被映射到了这个标准驿站
    if (settings.stationAliases) {
      for (const [alias, master] of Object.entries(settings.stationAliases)) {
        if (stationMap[master]) {
          stationMap[master].aliases.push(alias);
        }
      }
    }

    return Object.values(stationMap).sort((a, b) => b.count - a.count);
  }

  /**
   * 获取所有原始驿站名（未应用别名映射），用于合并选择
   */
  function getAllRawStationNames() {
    const set = new Set();
    parcels.forEach(p => {
      if (p.stationName) set.add(p.stationName.trim());
    });
    return Array.from(set).sort();
  }

  /**
   * 渲染驿站管理列表
   */
  function renderStationManageList() {
    const listEl = document.getElementById('station-manage-list');
    const emptyEl = document.getElementById('station-manage-empty');
    if (!listEl) return;

    const allStations = getAllStationsWithCount();
    // 分成显示的和隐藏的
    const visibleStations = allStations.filter(s =>
      !settings.hiddenStations || !settings.hiddenStations.includes(s.name));
    const hiddenStations = allStations.filter(s =>
      settings.hiddenStations && settings.hiddenStations.includes(s.name));

    if (allStations.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    let html = '';

    // 显示中的驿站
    if (visibleStations.length > 0) {
      html += `<div class="station-manage-section-title">显示中的驿站（${visibleStations.length}）</div>`;
      html += visibleStations.map(s => {
        const aliasHtml = s.aliases.length > 0
          ? `<div class="station-manage-alias">包含：${s.aliases.join('、')}</div>`
          : '';
        return `
          <div class="station-manage-item">
            <div class="station-manage-info">
              <div class="station-manage-name">${escapeHtml(s.name)}</div>
              <div class="station-manage-meta">${s.count} 个包裹</div>
              ${aliasHtml}
            </div>
            <div class="station-manage-actions">
              <button class="station-manage-btn" data-action="merge-station" data-name="${encodeURIComponent(s.name)}">
                合并
              </button>
              <button class="station-manage-btn btn-warn" data-action="hide-station-manage" data-name="${encodeURIComponent(s.name)}">
                隐藏
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    // 已隐藏的驿站
    if (hiddenStations.length > 0) {
      html += `<div class="station-manage-section-title">已隐藏的驿站（${hiddenStations.length}）</div>`;
      html += hiddenStations.map(s => {
        const aliasHtml = s.aliases.length > 0
          ? `<div class="station-manage-alias">包含：${s.aliases.join('、')}</div>`
          : '';
        return `
          <div class="station-manage-item station-hidden-item">
            <div class="station-manage-info">
              <div class="station-manage-name">${escapeHtml(s.name)}</div>
              <div class="station-manage-meta">${s.count} 个包裹</div>
              ${aliasHtml}
            </div>
            <div class="station-manage-actions">
              <button class="station-manage-btn btn-primary" data-action="unhide-station" data-name="${encodeURIComponent(s.name)}">
                恢复显示
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    listEl.innerHTML = html;

    // 绑定事件
    listEl.querySelectorAll('[data-action="merge-station"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stationName = decodeURIComponent(btn.dataset.name);
        openMergeStationModal(stationName);
      });
    });
    listEl.querySelectorAll('[data-action="hide-station-manage"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const stationName = decodeURIComponent(btn.dataset.name);
        const confirmed = await showConfirmDialog(
          `确定要隐藏「${stationName}」吗？\n（数据不会删除，下次收到新快递时会自动恢复）`,
          { icon: '🤔', okText: '隐藏' }
        );
        if (!confirmed) return;
        if (!settings.hiddenStations) settings.hiddenStations = [];
        if (!settings.hiddenStations.includes(stationName)) {
          settings.hiddenStations.push(stationName);
        }
        saveSettings();
        renderStationManageList();
        renderAll();
        showToast('已隐藏', 'success');
      });
    });
    listEl.querySelectorAll('[data-action="unhide-station"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stationName = decodeURIComponent(btn.dataset.name);
        unhideStation(stationName);
      });
    });
  }

  /**
   * 打开合并驿站弹窗：选择要把当前驿站合并到哪个驿站
   */
  function openMergeStationModal(sourceStation, triggerFrom = 'settings') {
    const allStations = getAllRawStationNames();
    const otherStations = allStations.filter(s => {
      // 排除自己，以及已经是同一个标准名的
      if (s === sourceStation) return false;
      const mapped = settings.stationAliases?.[s] || s;
      const sourceMapped = settings.stationAliases?.[sourceStation] || sourceStation;
      return mapped !== sourceMapped;
    });

    if (otherStations.length === 0) {
      showToast('没有可合并的驿站', 'info');
      return;
    }

    // 创建弹窗
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '2000';
    overlay.innerHTML = `
      <div class="merge-station-modal">
        <div class="merge-station-header">将「${escapeHtml(sourceStation)}」合并到...</div>
        <div class="merge-station-search">
          <input type="text" id="merge-search-input" placeholder="搜索驿站..." autofocus>
        </div>
        <div class="merge-station-list" id="merge-station-list">
          ${otherStations.map(s => `
            <div class="merge-station-option" data-target="${encodeURIComponent(s)}">
              ${escapeHtml(s)}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 点击背景关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });

    // 搜索过滤
    const searchInput = overlay.querySelector('#merge-search-input');
    const listEl = overlay.querySelector('#merge-station-list');
    searchInput.addEventListener('input', () => {
      const keyword = searchInput.value.trim().toLowerCase();
      listEl.querySelectorAll('.merge-station-option').forEach(opt => {
        const name = decodeURIComponent(opt.dataset.target).toLowerCase();
        opt.style.display = name.includes(keyword) ? '' : 'none';
      });
    });

    // 选择目标驿站
    listEl.querySelectorAll('.merge-station-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const targetStation = decodeURIComponent(opt.dataset.target);
        mergeStation(sourceStation, targetStation, triggerFrom);
        document.body.removeChild(overlay);
      });
    });

    setTimeout(() => searchInput.focus(), 50);
  }

  /**
   * 执行驿站合并：把 source 合并到 target（target 作为标准名）
   */
  function mergeStation(source, target, triggerFrom = 'settings') {
    if (!settings.stationAliases) settings.stationAliases = {};

    // 先看 source 本身有没有对应的标准名（即它是不是已经是别名）
    const currentMaster = settings.stationAliases[source] || source;
    const targetMaster = settings.stationAliases[target] || target;

    if (currentMaster === targetMaster) {
      showToast('已经是同一个驿站了', 'info');
      return;
    }

    // 设置 source 的别名为 target
    settings.stationAliases[source] = targetMaster;

    // 如果 source 之前还有别的别名指向它，也一起转过去
    for (const [alias, master] of Object.entries(settings.stationAliases)) {
      if (master === currentMaster && alias !== source) {
        settings.stationAliases[alias] = targetMaster;
      }
    }

    // 如果 currentMaster 不是 source 自己（说明 source 之前就是个别名），也要更新
    if (currentMaster !== source && currentMaster !== targetMaster) {
      settings.stationAliases[currentMaster] = targetMaster;
    }

    saveSettings();
    renderStationManageList();
    if (triggerFrom === 'popup') {
      renderStationManagePopupList();
    }
    renderAll();
    showToast(`已将「${source}」合并到「${targetMaster}」`, 'success');
  }

  /**
   * 取消某个驿站的合并（恢复独立）
   * 暂未做UI，留作扩展
   */
  function unmergeStation(stationName) {
    if (!settings.stationAliases) return;
    delete settings.stationAliases[stationName];
    saveSettings();
    renderStationManageList();
    renderAll();
  }

  // ===== 设置功能 =====
  function openSettingsModal() {
    updateSettingsStats();
    document.getElementById('vibration-toggle').checked = settings.vibration;
    document.getElementById('pending-confirm-toggle').checked = settings.pendingConfirmEnabled;
    document.getElementById('auto-clean-toggle').checked = settings.autoClean;
    document.getElementById('retention-days').value = settings.retentionDays;
    updateRetentionDesc();
    updateRetentionDaysOpacity();
    // 更新权限状态
    updatePermissionStatus();
    // 刷新版本显示
    initVersionInfo();
    // 渲染监听APP列表
    renderMonitorAppList();
    // 渲染驿站管理列表
    renderStationManageList();
    // 更新检查按钮描述
    const desc = document.getElementById('check-update-desc');
    if (desc) {
      desc.textContent = settings.updateUrl ? '点击检测是否有新版本' : '请先设置更新地址';
    }
    document.getElementById('settings-modal').style.display = 'flex';
  }

  function closeSettingsModal() {
    document.getElementById('settings-modal').style.display = 'none';
  }

  function updateSettingsStats() {
    const total = parcels.length;
    const completed = parcels.filter(p => p.status === '已取件' || p.status === '已签收').length;
    const pending = total - completed;
    const stationCount = groupByStation(parcels).length;

    document.getElementById('setting-total').textContent = total;
    document.getElementById('setting-stations').textContent = stationCount;
    document.getElementById('setting-completed').textContent = completed;
    document.getElementById('setting-pending').textContent = pending;
  }

  function updateRetentionDesc() {
    const days = document.getElementById('retention-days').value;
    const descEl = document.getElementById('clean-expired-desc');
    if (descEl) descEl.textContent = `将删除超过 ${days} 天的已取件/已签收快递`;
  }

  function updateRetentionDaysOpacity() {
    const row = document.getElementById('retention-days-row');
    const toggle = document.getElementById('auto-clean-toggle').checked;
    if (row) {
      row.style.opacity = toggle ? '1' : '0.5';
      row.style.pointerEvents = toggle ? 'auto' : 'none';
    }
  }

  function cleanExpired() {
    const days = parseInt(document.getElementById('retention-days').value);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const toRemove = parcels.filter(p =>
      (p.status === '已取件' || p.status === '已签收') &&
      (p.updatedAt || p.createdAt) <= cutoff
    );
    if (toRemove.length === 0) {
      showToast('没有需要清理的快递', 'warning');
      return;
    }
    if (!confirm(`确定要删除 ${toRemove.length} 条超过 ${days} 天的已完成快递吗？`)) return;
    parcels = parcels.filter(p => {
      if (p.status !== '已取件' && p.status !== '已签收') return true;
      return (p.updatedAt || p.createdAt) > cutoff;
    });
    saveData();
    renderAll();
    updateSettingsStats();
    showToast(`已清理 ${toRemove.length} 条`, 'success');
  }

  function cleanCompleted() {
    const toRemove = parcels.filter(p => p.status === '已取件' || p.status === '已签收');
    if (toRemove.length === 0) {
      showToast('没有已完成的快递', 'warning');
      return;
    }
    if (!confirm(`确定要删除全部 ${toRemove.length} 条已完成的快递记录吗？`)) return;
    parcels = parcels.filter(p => p.status !== '已取件' && p.status !== '已签收');
    saveData();
    renderAll();
    updateSettingsStats();
    showToast(`已清理 ${toRemove.length} 条`, 'success');
  }

  function cleanAll() {
    if (parcels.length === 0) {
      showToast('没有数据可以清空', 'warning');
      return;
    }
    if (!confirm('⚠️ 确定要清空所有快递数据吗？\n此操作不可恢复！建议先导出备份。')) return;
    if (!confirm('再次确认：真的要删除全部数据吗？')) return;
    parcels = [];
    saveData();
    renderAll();
    updateSettingsStats();
    showToast('已清空全部数据', 'success');
  }

  // ===== Android 短信回调 =====
  // APP 端收到新快递短信/通知时会调用这个函数
  window.onSmsReceived = function(smsData) {
    if (!smsData || !smsData.isExpress) return;

    // 用 JS 端的解析逻辑重新解析原文（作为权威结果）
    // 因为 Java 端的解析器可能不如 JS 端精确（如取件码截断问题）
    if (smsData.content) {
      const re = parseExpressText(smsData.content);
      if (re.pickupCode) smsData.pickupCode = re.pickupCode;
      if (re.stationName) smsData.stationName = re.stationName;
      if (re.stationAddress) smsData.stationAddress = re.stationAddress;
      if (re.carrier) smsData.carrier = re.carrier;
      if (re.isExpress) smsData.isExpress = true;
    }

    // 去重逻辑：
    // 1. 有取件码 → 按取件码去重（最准确）
    // 2. 没有取件码但有驿站名 → 按驿站名 + 快递单号去重
    // 3. 都没有 → 按内容全文去重（兜底）
    if (smsData.pickupCode) {
      const exists = parcels.some(p => p.pickupCode === smsData.pickupCode);
      if (exists) {
        console.log('取件码已存在，跳过:', smsData.pickupCode);
        return;
      }
    } else if (smsData.stationName && smsData.trackingNumber) {
      const exists = parcels.some(p =>
        p.stationName === smsData.stationName &&
        p.trackingNumber === smsData.trackingNumber);
      if (exists) {
        console.log('驿站+单号已存在，跳过');
        return;
      }
    } else if (smsData.content) {
      // 兜底：按内容前50字去重
      const contentKey = smsData.content.substring(0, 50);
      const exists = parcels.some(p =>
        p.notes && p.notes.includes(contentKey));
      if (exists) {
        console.log('内容重复，跳过');
        return;
      }
    }

    const stationName = smsData.stationName || smsData.location || '';
    const carrier = smsData.carrier || '';
    const itemName = carrier ? (carrier + '快递') : '快递包裹';
    const source = smsData.source === 'notification' ? '通知来源' : '短信来源';
    const sourceApp = smsData.sourceApp || smsData.sender || '';

    // 如果驿站是隐藏的，自动取消隐藏
    if (stationName && settings.hiddenStations && settings.hiddenStations.includes(stationName)) {
      const idx = settings.hiddenStations.indexOf(stationName);
      if (idx !== -1) settings.hiddenStations.splice(idx, 1);
      saveSettings();
    }

    const newParcel = {
      id: generateId(),
      itemName: itemName,
      trackingNumber: smsData.trackingNumber || '',
      carrier: carrier,
      status: smsData.status || '待取件',
      pickupCode: smsData.pickupCode || '',
      expectedDate: '',
      stationName: stationName,
      stationAddress: smsData.stationAddress || '',
      notes: smsData.content ? (source + '：' + sourceApp) : '',
      source: smsData.source || 'sms',
      sourceApp: sourceApp,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // 如果开启了待确认模式，先放待确认列表
    if (settings.pendingConfirmEnabled) {
      // 待确认列表也去重
      const pendingExists = pendingParcels.some(p =>
        (smsData.pickupCode && p.pickupCode === smsData.pickupCode) ||
        (smsData.stationName && smsData.trackingNumber &&
          p.stationName === smsData.stationName && p.trackingNumber === smsData.trackingNumber));
      if (!pendingExists) {
        pendingParcels.unshift(newParcel);
        savePendingParcels();
        renderPendingConfirmBar();
        vibrate([50, 30, 50]);
        showToast('✨ 新快递待确认', 'info');
      }
      return;
    }

    parcels.unshift(newParcel);
    saveData();
    renderAll();

    // 震动提醒
    if (newParcel.status === '待取件') {
      vibrate([100, 50, 100, 50, 200]);
    }

    const tip = newParcel.pickupCode ? `📦 新快递：取件码 ${newParcel.pickupCode}` : '📦 新快递到了';
    showToast(tip, 'success');
  };

  // DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ===== 返回键/手势返回支持 =====
  // 弹窗打开时 push 一条历史记录，返回时 pop 自动关闭最上层弹窗
  const modalStack = [];

  function pushModalState(name, closeFn) {
    modalStack.push({ name, closeFn });
    try {
      history.pushState({ modal: name }, '', '');
    } catch (e) {}
  }

  function popModalState() {
    if (modalStack.length > 0) {
      const top = modalStack.pop();
      try {
        if (history.state && history.state.modal) {
          history.back();
        }
      } catch (e) {}
      return top;
    }
    return null;
  }

  function handleBackPress() {
    // 按优先级关闭最上层的弹窗
    // 1. 确认对话框
    const confirmDialog = document.getElementById('confirm-dialog');
    if (confirmDialog && confirmDialog.style.display === 'flex') {
      const cancelBtn = document.getElementById('confirm-dialog-cancel');
      if (cancelBtn) cancelBtn.click();
      return true;
    }
    // 2. 驿站管理弹窗里的合并子弹窗
    const mergeModal = document.getElementById('station-merge-modal');
    if (mergeModal && mergeModal.style.display === 'flex') {
      closeMergePopup();
      return true;
    }
    // 3. 驿站管理弹窗
    const stationManageModal = document.getElementById('station-manage-modal');
    if (stationManageModal && stationManageModal.style.display === 'flex') {
      closeStationManagePopup();
      return true;
    }
    // 4. 编辑弹窗
    if (els.modalOverlay && els.modalOverlay.style.display === 'flex') {
      closeModal();
      return true;
    }
    // 5. 详情弹窗
    if (els.detailOverlay && els.detailOverlay.style.display === 'flex') {
      closeDetail();
      return true;
    }
    // 6. 使用说明弹窗
    const usageModal = document.getElementById('usage-modal');
    if (usageModal && usageModal.style.display === 'flex') {
      usageModal.style.display = 'none';
      return true;
    }
    // 7. 设置弹窗
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && settingsModal.style.display === 'flex') {
      closeSettingsModal();
      return true;
    }
    return false;
  }

  window.addEventListener('popstate', (e) => {
    const handled = handleBackPress();
    if (handled) {
      // 阻止默认行为
      e.preventDefault && e.preventDefault();
    }
  });

  // 暴露给 Android 调用
  window.handleBackPress = handleBackPress;

})();
