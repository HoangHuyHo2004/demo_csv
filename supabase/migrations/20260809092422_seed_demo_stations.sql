-- Two demo stations matching the prototype's mockup colors, so the
-- existing design's color choices keep meaning something once real data
-- lands.
insert into public.stations (name, code, address, color, timezone, currency)
values
  ('Station A · Quận 1', 'STN-A', '142 Nguyễn Huệ, Q1, HCMC', '#3455b3', 'Asia/Ho_Chi_Minh', 'VND'),
  ('Station B · Thủ Đức', 'STN-B', '88 Võ Văn Ngân, Thủ Đức', '#1f6f4a', 'Asia/Ho_Chi_Minh', 'VND');
