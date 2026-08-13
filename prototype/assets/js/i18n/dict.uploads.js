// Uploads page (uploads.html) and its controller (upload.js): dropzone,
// bulk file intake, category picker, duplicate-date overwrite banner,
// save button, data-categories panel, and upload history.
export const en = {
  'uploads.searchPlaceholder': 'Search uploads, categories, filenames…',
  'uploads.uploadFileCta': 'Upload file',
  'uploads.pageDesc': 'Upload daily CSV or Excel files and manage data categories — columns are mapped to metrics automatically.',

  'uploads.tabs.upload': 'Upload',
  'uploads.tabs.history': 'History',
  'uploads.tabs.categories': 'Categories',

  'uploads.card.title': 'Upload CSV or Excel files',
  'uploads.dropzone.title': 'Drop CSV or Excel files here',
  'uploads.dropzone.hint': '.csv, .xlsx, .xls — or click to browse — you can drop several at once (bulk upload supported)',
  'uploads.dropzone.browse': 'Browse files',

  'uploads.fileRow.categoryPlaceholder': 'category',
  'uploads.fileRow.datePlaceholder': 'dd/mm/yyyy',
  'uploads.fileRow.dateOverrideTitle': 'Override the detected date',
  'uploads.fileRow.openCalendar': 'Open calendar',
  // "{{metrics}} tracked" rather than "{{metrics}} metrics" -- sidesteps the
  // English plural agreement ("1 metrics" reads as a bug), same fix as
  // stats.kpi.idlePumps.
  'uploads.fileRow.subResolved': '{{size}} KB · {{rows}} rows · {{metrics}} tracked · date {{date}} ({{source}})',
  'uploads.fileRow.subUnresolved': '{{size}} KB · {{rows}} rows · {{metrics}} tracked · date unresolved',

  'uploads.dateSource.column': 'column',
  'uploads.dateSource.filename': 'filename',
  'uploads.dateSource.manual': 'manual',

  'uploads.selectStationOption': '— Select station —',

  'uploads.status.parsing': 'Parsing…',
  'uploads.status.needsStation': 'Select a station',
  'uploads.status.needsCategory': 'Enter a category',
  'uploads.status.needsDate': 'Set the date',
  'uploads.status.duplicate': 'Date exists',
  'uploads.status.ready': 'Ready',
  'uploads.status.saving': 'Saving…',
  'uploads.status.saved': 'Saved',

  'uploads.duplicate.exists': 'a record for <b>{{category}}</b> on <b>{{date}}</b> already exists.',
  'uploads.duplicate.confirmedNote': 'Overwrite confirmed — the old values will be replaced when you save.',
  'uploads.duplicate.previewNote': 'Uploading will overwrite. Preview of change:',
  'uploads.duplicate.noOverlap': 'No overlapping tracked metrics.',
  'uploads.duplicate.confirmButton': 'Confirm overwrite',
  'uploads.duplicate.newSuffix': '(new)',

  'uploads.actions.confirmSave': 'Confirm & save',
  'uploads.actions.confirmSaveCount': 'Confirm & save {{n}} file{{s}}',

  'uploads.error.emptyFile': 'Empty file or no columns detected.',
  'uploads.error.uploadFailed': 'Could not upload file: {{message}}',
  'uploads.error.overwritePrep': 'Could not prepare overwrite: {{message}}',
  'uploads.error.duplicateRace': 'Another upload for this station/date/category was just created — reload and try again.',
  'uploads.error.saveValuesFailed': 'Could not save values: {{message}}',

  'uploads.categories.title': 'Data Categories',
  'uploads.categories.addNew': '＋ Add new category',
  'uploads.categories.empty': 'No categories yet — add one, or one will be created the first time you type a new name in the upload row.',
  // Phrased to avoid an English plural agreement ("1 uploads" reads as a bug) --
  // same fix as stats.kpi.idlePumps.
  'uploads.categories.uploadCount': 'Uploads: {{n}}',

  'uploads.categoryModal.title': 'Add category',
  'uploads.categoryModal.body': 'Categories are shared across every station — creating one here makes it available to everyone.',
  'uploads.categoryModal.nameLabel': 'Name',
  'uploads.categoryModal.namePlaceholder': 'e.g. Rent, Utilities',
  'uploads.categoryModal.create': 'Create',
  'uploads.categoryModal.errorEmpty': 'Enter a name.',
  'uploads.categoryModal.errorExists': 'That category already exists.',
  'uploads.categoryModal.errorFailed': 'Could not create the category — try again.',

  'uploads.history.title': 'Upload History',
  'uploads.history.desc': 'Every past upload — click to view, edit, or export.',
  'uploads.history.searchPlaceholder': 'Search filename…',
  'uploads.history.allCategories': 'All categories',
  'uploads.history.allStatuses': 'All statuses',
  'uploads.history.empty': 'No uploads yet.',
  'uploads.history.col.date': 'Date',
  'uploads.history.col.station': 'Station',
  'uploads.history.col.category': 'Category',
  'uploads.history.col.filename': 'Filename',
  'uploads.history.col.rows': 'Rows',
  'uploads.history.col.metrics': 'Metrics',
  'uploads.history.col.status': 'Status',
  'uploads.history.col.uploadedBy': 'Uploaded by',
};

export const vi = {
  'uploads.searchPlaceholder': 'Tìm bản tải lên, danh mục, tên tệp…',
  'uploads.uploadFileCta': 'Tải lên tệp',
  'uploads.pageDesc': 'Tải lên tệp CSV hoặc Excel hằng ngày và quản lý danh mục dữ liệu — cột được ánh xạ thành chỉ số tự động.',

  'uploads.tabs.upload': 'Tải lên',
  'uploads.tabs.history': 'Lịch sử',
  'uploads.tabs.categories': 'Danh mục',

  'uploads.card.title': 'Tải lên tệp CSV hoặc Excel',
  'uploads.dropzone.title': 'Thả tệp CSV hoặc Excel vào đây',
  'uploads.dropzone.hint': '.csv, .xlsx, .xls — hoặc nhấn để chọn tệp — bạn có thể thả nhiều tệp cùng lúc (hỗ trợ tải lên hàng loạt)',
  'uploads.dropzone.browse': 'Chọn tệp',

  'uploads.fileRow.categoryPlaceholder': 'danh mục',
  'uploads.fileRow.datePlaceholder': 'dd/mm/yyyy',
  'uploads.fileRow.dateOverrideTitle': 'Ghi đè ngày đã phát hiện',
  'uploads.fileRow.openCalendar': 'Mở lịch',
  'uploads.fileRow.subResolved': '{{size}} KB · {{rows}} dòng · {{metrics}} chỉ số · ngày {{date}} ({{source}})',
  'uploads.fileRow.subUnresolved': '{{size}} KB · {{rows}} dòng · {{metrics}} chỉ số · ngày chưa xác định',

  'uploads.dateSource.column': 'cột',
  'uploads.dateSource.filename': 'tên tệp',
  'uploads.dateSource.manual': 'thủ công',

  'uploads.selectStationOption': '— Chọn trạm —',

  'uploads.status.parsing': 'Đang phân tích…',
  'uploads.status.needsStation': 'Chọn một trạm',
  'uploads.status.needsCategory': 'Nhập danh mục',
  'uploads.status.needsDate': 'Đặt ngày',
  'uploads.status.duplicate': 'Ngày đã tồn tại',
  'uploads.status.ready': 'Sẵn sàng',
  'uploads.status.saving': 'Đang lưu…',
  'uploads.status.saved': 'Đã lưu',

  'uploads.duplicate.exists': 'đã tồn tại một bản ghi cho <b>{{category}}</b> vào ngày <b>{{date}}</b>.',
  'uploads.duplicate.confirmedNote': 'Đã xác nhận ghi đè — các giá trị cũ sẽ được thay thế khi bạn lưu.',
  'uploads.duplicate.previewNote': 'Tải lên sẽ ghi đè dữ liệu. Xem trước thay đổi:',
  'uploads.duplicate.noOverlap': 'Không có chỉ số theo dõi nào trùng lặp.',
  'uploads.duplicate.confirmButton': 'Xác nhận ghi đè',
  'uploads.duplicate.newSuffix': '(mới)',

  'uploads.actions.confirmSave': 'Xác nhận & lưu',
  'uploads.actions.confirmSaveCount': 'Xác nhận & lưu {{n}} tệp',

  'uploads.error.emptyFile': 'Tệp trống hoặc không phát hiện được cột nào.',
  'uploads.error.uploadFailed': 'Không thể tải lên tệp: {{message}}',
  'uploads.error.overwritePrep': 'Không thể chuẩn bị ghi đè: {{message}}',
  'uploads.error.duplicateRace': 'Một bản tải lên khác cho trạm/ngày/danh mục này vừa được tạo — hãy tải lại trang và thử lại.',
  'uploads.error.saveValuesFailed': 'Không thể lưu giá trị: {{message}}',

  'uploads.categories.title': 'Danh mục dữ liệu',
  'uploads.categories.addNew': '＋ Thêm danh mục mới',
  'uploads.categories.empty': 'Chưa có danh mục nào — hãy thêm một danh mục, hoặc danh mục sẽ được tạo tự động khi bạn nhập tên mới ở dòng tải lên.',
  'uploads.categories.uploadCount': 'Lượt tải lên: {{n}}',

  'uploads.categoryModal.title': 'Thêm danh mục',
  'uploads.categoryModal.body': 'Danh mục được dùng chung cho mọi trạm — tạo tại đây sẽ áp dụng cho tất cả.',
  'uploads.categoryModal.nameLabel': 'Tên',
  'uploads.categoryModal.namePlaceholder': 'vd: Tiền thuê, Điện nước',
  'uploads.categoryModal.create': 'Tạo',
  'uploads.categoryModal.errorEmpty': 'Nhập tên danh mục.',
  'uploads.categoryModal.errorExists': 'Danh mục này đã tồn tại.',
  'uploads.categoryModal.errorFailed': 'Không thể tạo danh mục — hãy thử lại.',

  'uploads.history.title': 'Lịch sử tải lên',
  'uploads.history.desc': 'Mọi bản tải lên trước đây — nhấn để xem, chỉnh sửa hoặc xuất dữ liệu.',
  'uploads.history.searchPlaceholder': 'Tìm tên tệp…',
  'uploads.history.allCategories': 'Tất cả danh mục',
  'uploads.history.allStatuses': 'Tất cả trạng thái',
  'uploads.history.empty': 'Chưa có bản tải lên nào.',
  'uploads.history.col.date': 'Ngày',
  'uploads.history.col.station': 'Trạm',
  'uploads.history.col.category': 'Danh mục',
  'uploads.history.col.filename': 'Tên tệp',
  'uploads.history.col.rows': 'Số dòng',
  'uploads.history.col.metrics': 'Chỉ số',
  'uploads.history.col.status': 'Trạng thái',
  'uploads.history.col.uploadedBy': 'Người tải lên',
};
