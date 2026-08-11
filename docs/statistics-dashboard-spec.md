# Statistics dashboard — proposed rebuild

**Status:** draft for review (rev. 2 — narrowed to the six focus columns)
**Source analysed:** `Book1.xlsx`, sheet `T01 (2)` — a Vietnamese petrol station (name
withheld), January 2024. Revenue figures below are real but the business is not
identified in this document.
**Supersedes:** the current `statistics.html`, whose widgets were built against invented mockup data

---

## 1. Scope

Six focus columns only. Everything else in the sheet is out of scope until asked for.

| Column | Sheet ref | Role | Meaning |
|---|---|---|---|
| `CA` | A | dimension | Shift label (see §2) |
| `NGÀY THÁNG` | B | dimension | Date, DD/MM/YYYY |
| `TÊN HÀNG` | **O** | dimension | Product — petrol type **and** pump no. |
| `SB` | R | measure | Volume sold |
| `ĐG` | S | measure | Unit price, ₫ |
| `TT` | T | measure | Amount, ₫ |

`TÊN HÀNG` is **column O**, not column F. The `(TRỤ n)` format only occurs in O, and
O/R/S/T are one contiguous ledger. Column F holds a different product list and is not used.

**Exclusion rule:** if `NGÀY THÁNG` contains `TỔNG`, the entire row is dropped.
35 such rows in January.

**Grain:** one row = one product, one shift, one day.

`TÊN HÀNG` splits into two dimensions: `A95 (TRỤ 2)` → petrol type `A95`, pump `2`.

### Deliberately out of scope

No cash-vs-debt split, no receivables, no `CL` meter-variance chart — those live in
columns set aside. No profit or margin: the sheet contains no cost price, so any margin
figure would be invented.

---

## 2. Decisions locked in

| Decision | Choice |
|---|---|
| `CA` | A shift label represented by one person's name. A shift actually has 3–4 staff. **No staff-performance chart.** |
| Oils / non-pump items | Shown **separately**, and **included** in the `TT` total. |
| `DO (TRỤ 5)` | Shown in the pump ranking, **flagged as idle**. |
| Margin / profit | Out of scope — no cost price exists. |
| Time range | Month view + month-over-month comparison. |
| Ingestion | Keep the generic column mapper. **One CSV per day**, split by a local converter — no app changes (§8). |

### How `CA` is used, given no performance chart

`CA` is on the focus list but must not drive a staff comparison. It therefore appears as:

- a **column in the daily data table** — who was on duty that day, and
- an optional **filter** on the whole page.

No chart ranks or scores shifts against each other. *Flag this if you intended something
else for `CA` — it is the one item in the focus list without an obvious visual home.*

---

## 3. Data quality

Clean. Checked, not assumed:

- **311 usable rows** after dropping 35 `TỔNG` rows
- **Zero** missing dates, shifts, or product names
- **`TT` = `SB` × `ĐG` on all 311 rows — no mismatches**
- 280 pump rows (8 pumps × 35 blocks) + 31 oil rows
- 4 days carry two blocks — Jan 4, 11, 18, 25, all Thursdays, split by the weekly
  national price adjustment. Not a shift split.

### One unit problem to resolve

`SB` is litres for fuel, but for oils it mixes units: `CANTEX` qty 1 at 1,250,000 ₫ is a
container, not a litre. **Total volume is therefore reported as fuel only (130,972 L).**
Adding oils to make 131,019.55 would sum litres of petrol with pieces of CANTEX and mean
nothing. Amount (`TT`) has no such problem and totals across everything.

---

## 4. January 2024 baseline

| | |
|---|---|
| Total amount | **2,850,178,090 ₫** (fuel 2,845,978,090 + oils 4,200,000) |
| Fuel volume | **130,972 L** |
| Avg fuel price | **21,729 ₫/L** |
| Avg per day | **91,941,229 ₫** — min 75,906,080 (Thu 11th) · max 110,573,720 (Mon 29th) |
| Price changes | 4, every Thursday |

**By petrol type**

| Type | Volume | Amount | ₫/L | Share |
|---|---:|---:|---:|---:|
| A95 | 72,408 L | 1,635,105,200 | 22,582 | 57.4% |
| DO | 31,785 L | 632,568,180 | 19,901 | 22.2% |
| E5 | 26,779 L | 578,304,710 | 21,595 | 20.3% |
| Oils | — | 4,200,000 | — | 0.15% |

**By pump** — load is very uneven within the same fuel

| Pump | Volume | Amount | Share |
|---|---:|---:|---:|
| A95 trụ 2 | 35,082 L | 792,320,390 | 27.8% |
| A95 trụ 6 | 23,319 L | 526,335,770 | 18.5% |
| E5 trụ 3 | 21,327 L | 460,485,900 | 16.2% |
| DO trụ 8 | 19,092 L | 380,684,470 | 13.4% |
| A95 trụ 4 | 14,007 L | 316,449,040 | 11.1% |
| DO trụ 1 | 12,693 L | 251,883,710 | 8.9% |
| E5 trụ 7 | 5,452 L | 117,818,810 | 4.1% |
| **DO trụ 5** | **0** | **0** | **0%** ⚠ idle all month |

A95 trụ 2 moves 2.5× trụ 4; E5 trụ 3 moves 3.9× trụ 7.

**Oils** — 6 products, 4,200,000 ₫

| Product | Qty | Amount | Unit price |
|---|---:|---:|---:|
| N50 | 23.55 | 1,295,000 | 55,000 |
| CANTEX | 1 | 1,250,000 | 1,250,000 |
| NHỚT XE SỐ | 13 | 1,040,000 | 80,000 |
| DẦU THẮNG | 4 | 220,000 | 55,000 |
| MỠ | 4 | 205,000 | 50–55,000 |
| NHỚT XE GA | 2 | 190,000 | 95,000 |

> A single CANTEX sale is 30% of the month's oil revenue. Not an error, but it will
> dominate any oil chart — worth knowing before reading that panel.

**Price timeline** — new price takes effect mid-afternoon, so the split day carries both

| Effective | A95 | E5 | DO |
|---|---:|---:|---:|
| Jan 1 | 22,340 | 21,380 | 19,780 |
| Jan 4 (Thu) | 22,110 | 21,200 | 19,360 |
| Jan 11 (Thu) | 22,130 | 21,240 | 19,700 |
| Jan 18 (Thu) | 22,680 | 21,610 | 20,190 |
| Jan 25 (Thu) | 23,600 | 22,370 | 20,370 |

**Day-of-week pattern** — a real 15% spread

Mon 99.2M · Sat 95.5M · Sun 93.0M · Wed 90.3M · Fri 90.8M · Tue 88.2M · Thu 86.1M ₫

---

## 5. KPI row

| # | KPI | Formula |
|---|---|---|
| 1 | **Tổng doanh thu** | Σ `TT` — all products incl. oils |
| 2 | **Sản lượng nhiên liệu** | Σ `SB` where product is a pump — **fuel only**, labelled as such |
| 3 | **Giá bán BQ/L** | fuel amount ÷ fuel litres. Separates *sold more* from *price rose* — essential in a month with 4 adjustments |
| 4 | **Doanh thu BQ/ngày** | Σ `TT` ÷ active days |

Each carries a month-over-month delta. **With only January loaded every delta renders
"—"**; that is correct, not a bug.

---

## 6. Charts

| # | Chart | Type | Notes |
|---|---|---|---|
| 1 | Doanh thu & sản lượng theo ngày | Bars + line, dual axis | 31 days. Mark the 4 price-change Thursdays. |
| 2 | Cơ cấu sản phẩm | Donut + table | A95 / E5 / DO by amount and litres. Oils as one slice for completeness; detail in chart 6. |
| 3 | Giá bán theo thời gian | **Step** line, 3 series | Step, not smooth — prices hold flat then jump. |
| 4 | Hiệu suất trụ bơm | Horizontal bars, ranked | All 8 pumps. `DO trụ 5` shown at zero with a "không hoạt động" flag. |
| 5 | Doanh thu theo thứ trong tuần | Bars, Mon–Sun | Avg per weekday. Surfaces the Monday peak / Thursday trough. |
| 6 | Dầu nhớt | Table + small bars | All 6 oils separately: qty, amount, unit price. |
| 7 | Bảng dữ liệu ngày | Table, exportable | date · `CA` · litres per fuel · amount. `CA` lives here. |

Charts **3, 4, 5 and 6** have no equivalent on the current page.

---

## 7. Layout

```
┌─ KPI ROW ────────────────────────────────────────────────────────────┐
│  Tổng doanh thu   Sản lượng NL   Giá BQ/L   Doanh thu BQ/ngày        │
└──────────────────────────────────────────────────────────────────────┘
┌─ 1. Doanh thu & sản lượng theo ngày ─────────┬─ 2. Cơ cấu sản phẩm ──┐
├─ 3. Giá bán theo thời gian ──────────────────┼─ 4. Hiệu suất trụ bơm ┤
├─ 5. Doanh thu theo thứ trong tuần ───────────┼─ 6. Dầu nhớt ─────────┤
├─ 7. Bảng dữ liệu ngày ───────────────────────────────────────────────┤
└──────────────────────────────────────────────────────────────────────┘
```

Header: month picker · "so với tháng trước" toggle · `CA` filter · existing station scope
switcher. Two-thirds / one-third split on rows 1–3; full width for the table.

---

## 8. Ingestion — resolved

**Decision: one CSV per day, no app changes.**

`upload.js` writes every row of a file against a **single** `value_date`
([upload.js:482](../prototype/assets/js/upload.js#L482)), so a 31-day sheet pushed through the
generic mapper would produce one day holding the month's sum — wrong numbers, silently.
Splitting the month before upload avoids touching the save path at all.

### The converter

[`tools/convert_journal.py`](../tools/convert_journal.py) — runs locally, outside the app.

```bash
python tools/convert_journal.py Book1.xlsx -o out/
```

Reads only the six focus columns, drops `TỔNG` rows, splits `TÊN HÀNG` into petrol type +
pump, and writes one CSV per day with an identical header. Days carrying two price blocks
(the weekly Thursday adjustment) are summed, and that day's unit price becomes the
**volume-weighted average** of both blocks.

**Verified against the source — every figure ties exactly:**

| Check | Result |
|---|---|
| Files written | 31, identical 36-column header |
| Σ `tt_*` | 2,850,178,090 ₫ — exact |
| Σ fuel `sl_*` | 130,972.00 L — exact |
| A95 / DO / E5 amount & volume | exact on all six |
| Oils | 4,200,000 ₫ — exact |
| Shift days | 4 shift labels, 2/7/13/9 days respectively — exact |

**And through the app's unmodified parser:** 0 parse errors · 36 columns typed as
1 date + 35 numbers · `date` column auto-detected · `01/01/2024` → `2024-01-01` (day-first,
correct) · **zero text columns** (nothing silently dropped) · **zero false snapshot
matches** · 35 metrics tracked.

> `sl_n50 = 0.364` round-trips correctly only because of the earlier
> comma-thousands/dot-decimal fix in `csv.js`. Under the previous Vietnamese-locale
> default it would have been read as **364**.

### Column contract (36)

| Group | Columns |
|---|---|
| Date | `date` — DD/MM/YYYY |
| Shift | `ca_<slug>` per shift label — 1 on that shift's days, else 0 |
| Per pump | `sl_a95_tru2` `tt_a95_tru2` … `sl_e5_tru7` `tt_e5_tru7` (8 pumps × 2) |
| Price | `gia_a95` `gia_do` `gia_e5` — blank, not 0, when nothing sold |
| Oils | `sl_` / `tt_` × `cantex` `daau_thawng` `mow` `n50` `nhowt_xe_ga` `nhowt_xe_soo` |

Petrol-type totals are **derived** by summing pumps, never uploaded separately, so they
cannot disagree with the pump figures.

**Telex slugs.** Two shift labels (or two product names) that differ only by vowel
diacritic — e.g. one spelled with `ă` and another with `â` — are still **different**
entities in the source data. Plain ASCII folding strips the diacritic and merges them,
silently summing two people's or two products' figures together. So vowel shape is
preserved Telex-style (`ă`→`aw`, `â`→`aa`, `ê`→`ee`, `ô`→`oo`, `ơ`→`ow`, `ư`→`uw`) rather
than dropped. The converter **aborts** if two source names ever collide into one column
regardless — this is a belt-and-braces check, not just documentation of intent.

**Aggregation.** `sl_*`/`tt_*`/`ca_*` sum correctly. `gia_*` must **not** be summed across
days — the dashboard derives the month's average price as Σ`tt` ÷ Σ`sl` rather than
averaging `gia_*`, so no registry change is needed and the two can never disagree.

### Practical cost of this choice

31 uploads per month. Softened by two existing behaviours: the dropzone accepts a **bulk
drag of all 31 files at once**, and each row's station **pre-fills from the header scope
switcher**. Category still has to be set per row. If that proves tedious in practice,
extending the mapper to multi-date files remains available — it needs no schema change
(`metric_values.value_date` is already per-row and `metric_daily` already groups by it).

---

## 9. Limits to state on the page

- **No profit or margin** — no cost price in the source.
- **Volume totals are fuel-only** — oil units are not litres.
- **No hour-of-day analysis** — timestamps are date-only.
- **Month-over-month is empty** until a second month is uploaded.
- **`CL` meter variance is not shown** — column set aside. The dashboard therefore has
  no loss or integrity signal at all.
