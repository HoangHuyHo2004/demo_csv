-- Global category registry (not per-station), mirroring public.metrics: two
-- stations using the same category (e.g. "sales") show up as one category
-- everywhere rather than duplicating per station. This replaces the
-- previously-static "Data Categories" panel, which was hardcoded HTML with
-- invented upload counts and a dead "+ Add new category" button.
create table public.categories (
  slug         text primary key,             -- canonical value stored in uploads.category
  name         text not null,
  icon         text,
  description  text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

alter table public.categories enable row level security;

-- Same shape as public.metrics: any signed-in user can read and create a
-- category (an accountant uploading a CSV needs to be able to name a new
-- category on the spot, from the upload row itself), only the Owner can
-- rename or remove one.
create policy "categories: read all authenticated" on public.categories
  for select using (auth.role() = 'authenticated');
create policy "categories: insert authenticated" on public.categories
  for insert with check (auth.role() = 'authenticated');
create policy "categories: owner update" on public.categories
  for update using (public.is_owner()) with check (public.is_owner());
create policy "categories: owner delete" on public.categories
  for delete using (public.is_owner());

-- Seeded to match every category value already saved in uploads.category
-- (checked against the live table before writing this), so nothing
-- already-saved becomes an "unknown" category once this table is the
-- source of truth -- plus 'purchases'/'inventory', which have no uploads
-- yet but match the original mockup panel and the Upload History filter's
-- old hardcoded options.
--
--   slug        live uploads  meaning
--   nhat_ky     31            the converted daily sales journal (see
--                             tools/convert_journal.py) -- the real dataset
--   sales       5             Phase 4 test uploads
--   doanh so    2             an earlier manual test upload; the slug has a
--                             literal space because it was typed before this
--                             registry existed to normalize it -- kept
--                             as-is rather than silently rewriting saved data
--   losses      1             Phase 4 test upload
insert into public.categories (slug, name, icon, description) values
  ('nhat_ky', 'Nhật ký bán hàng', '📒', 'Nhật ký bán hàng hằng ngày (chuyển đổi từ Excel)'),
  ('sales', 'Doanh số', '💰', 'Sản lượng bán hàng & doanh thu hằng ngày'),
  ('doanh so', 'Doanh số (thử nghiệm)', '💰', 'Bản ghi thử nghiệm trước khi có danh mục chính thức'),
  ('purchases', 'Nhập hàng', '📦', 'Đơn hàng nhập từ nhà cung cấp'),
  ('losses', 'Hao hụt', '📉', 'Hao hụt, thất thoát, hư hỏng'),
  ('inventory', 'Tồn kho', '🏬', 'Ảnh chụp tồn kho hiện có');
