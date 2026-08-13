// index.html (Owner Dashboard) + dashboard.js + first-run.js. Also owns
// the shared `empty.*` keys used by empty.js -- that module has no page
// of its own, and both index.html (dashboard.js) and statistics.html
// (statistics.js) call t('empty.xxx'), so the keys live here rather than
// being duplicated per page.
export const en = {
  'index.header.title': 'Owner Dashboard',
  'index.header.searchPlaceholder': 'Search anything in Demo_CSV…',
  'index.header.uploadCta': "Upload today's CSV",
  'index.page.title': 'Dashboard',
  'index.page.desc': 'An easy way to track your business with care and precision.',
  'index.page.dateRange': 'January 2026 – July 2026 ▾',

  'index.promo.tag': 'Update',
  'index.promo.date': 'Jul 28th 2026',
  'index.promo.headline': 'Sales revenue increased <b>40% in 1 week</b>',
  'index.promo.seeStatistics': 'See Statistics ›',

  'index.kpi.netIncome': 'Net Income (revenue)',
  'index.kpi.totalLosses': 'Total Losses',
  'index.kpi.vsPrior30Days': 'vs prior 30 days',

  'index.recentUploads.title': 'Recent Uploads',

  'index.legend.revenue': 'Revenue',
  'index.legend.purchases': 'Purchases',
  'index.revenue.vsPriorPeriod': 'vs prior period',
  'index.revenue.noStationBreakdown': 'No station breakdown yet.',

  'index.metricBreakdown.title': 'Metric Breakdown',

  'index.donut.title': 'Top Metrics (30 days)',
  'index.donut.centerLabel': 'Records (30d)',
  'index.donut.tips': 'Share of tracked activity by metric, last 30 days.',
  'index.donut.seeFullStatistics': 'See full statistics',

  'firstRun.step1.heading': 'Set up Demo_CSV',
  'firstRun.step1.body': 'No one owns this workspace yet. Become the Owner to get full access and create your first station.',
  'firstRun.step1.cta': 'Become the Owner',
  'firstRun.step1.ctaBusy': 'Setting up…',
  'firstRun.step1.errorOwnerExists': 'An owner already exists for this workspace. Ask them to add you to a station.',

  'firstRun.step2.heading': 'Create your first station',
  'firstRun.step2.body': "You're the Owner now. Add a location to start tracking data.",
  'firstRun.step2.nameLabel': 'Station name',
  'firstRun.step2.namePlaceholder': 'e.g. Station A · Quận 1',
  'firstRun.step2.codeLabel': 'Short code',
  'firstRun.step2.codePlaceholder': 'STN-A',
  'firstRun.step2.cta': 'Create station',
  'firstRun.step2.ctaBusy': 'Creating…',
  'firstRun.step2.errorNameRequired': 'Station name is required.',

  'empty.noDataYet': 'No data yet.',
  'empty.noDataUploadCsv': 'No data yet — upload a CSV to see this chart.',
  'empty.noMetricsTrackedPeriod': 'No metrics tracked in this period yet.',
  'empty.noMetricsTrackedYet': 'No metrics tracked yet.',
  'empty.noUploadsYet': 'No uploads yet — head to Uploads to add your first CSV.',
  'empty.noStationsAccessible': 'No stations accessible yet.',
  'empty.noLossesTracked': 'No losses tracked yet.',
};

export const vi = {
  'index.header.title': 'Bảng điều khiển Chủ sở hữu',
  'index.header.searchPlaceholder': 'Tìm bất kỳ nội dung nào trong Demo_CSV…',
  'index.header.uploadCta': 'Tải lên CSV hôm nay',
  'index.page.title': 'Bảng điều khiển',
  'index.page.desc': 'Cách đơn giản để theo dõi hoạt động kinh doanh của bạn một cách cẩn thận và chính xác.',
  'index.page.dateRange': 'Tháng 1/2026 – Tháng 7/2026 ▾',

  'index.promo.tag': 'Cập nhật',
  'index.promo.date': '28/07/2026',
  'index.promo.headline': 'Doanh thu bán hàng tăng <b>40% trong 1 tuần</b>',
  'index.promo.seeStatistics': 'Xem Thống kê ›',

  'index.kpi.netIncome': 'Thu nhập ròng (doanh thu)',
  'index.kpi.totalLosses': 'Tổng hao hụt',
  'index.kpi.vsPrior30Days': 'so với 30 ngày trước',

  'index.recentUploads.title': 'Tệp tải lên gần đây',

  'index.legend.revenue': 'Doanh thu',
  'index.legend.purchases': 'Nhập hàng',
  'index.revenue.vsPriorPeriod': 'so với kỳ trước',
  'index.revenue.noStationBreakdown': 'Chưa có dữ liệu phân theo trạm.',

  'index.metricBreakdown.title': 'Phân tích chỉ số',

  'index.donut.title': 'Chỉ số hàng đầu (30 ngày)',
  'index.donut.centerLabel': 'Bản ghi (30 ngày)',
  'index.donut.tips': 'Tỷ trọng hoạt động được ghi nhận theo từng chỉ số, trong 30 ngày qua.',
  'index.donut.seeFullStatistics': 'Xem đầy đủ thống kê',

  'firstRun.step1.heading': 'Thiết lập Demo_CSV',
  'firstRun.step1.body': 'Chưa có ai sở hữu không gian làm việc này. Hãy trở thành Chủ sở hữu để có toàn quyền truy cập và tạo trạm đầu tiên của bạn.',
  'firstRun.step1.cta': 'Trở thành Chủ sở hữu',
  'firstRun.step1.ctaBusy': 'Đang thiết lập…',
  'firstRun.step1.errorOwnerExists': 'Không gian làm việc này đã có chủ sở hữu. Hãy nhờ họ thêm bạn vào một trạm.',

  'firstRun.step2.heading': 'Tạo trạm đầu tiên của bạn',
  'firstRun.step2.body': 'Bạn hiện là Chủ sở hữu. Hãy thêm một địa điểm để bắt đầu theo dõi dữ liệu.',
  'firstRun.step2.nameLabel': 'Tên trạm',
  'firstRun.step2.namePlaceholder': 'ví dụ: Trạm A · Quận 1',
  'firstRun.step2.codeLabel': 'Mã viết tắt',
  'firstRun.step2.codePlaceholder': 'STN-A',
  'firstRun.step2.cta': 'Tạo trạm',
  'firstRun.step2.ctaBusy': 'Đang tạo…',
  'firstRun.step2.errorNameRequired': 'Vui lòng nhập tên trạm.',

  'empty.noDataYet': 'Chưa có dữ liệu.',
  'empty.noDataUploadCsv': 'Chưa có dữ liệu — hãy tải lên một tệp CSV để xem biểu đồ này.',
  'empty.noMetricsTrackedPeriod': 'Chưa có chỉ số nào được ghi nhận trong kỳ này.',
  'empty.noMetricsTrackedYet': 'Chưa có chỉ số nào được ghi nhận.',
  'empty.noUploadsYet': 'Chưa có tệp tải lên — vào mục Tải lên để thêm tệp CSV đầu tiên.',
  'empty.noStationsAccessible': 'Chưa có trạm nào bạn được truy cập.',
  'empty.noLossesTracked': 'Chưa ghi nhận hao hụt nào.',
};
