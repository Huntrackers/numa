# ماتریس پذیرش نوما ۱.۰

مرجع، معیارهای T01 تا T42 در سند مصوب است. «پوشش آزمون» در این جدول به شاهد مشخص اشاره دارد. آزمون بومی قرارداد، آزمون واحد/API، مرورگر با مرز امضای fixture و تراکنش واقعی تست‌نت از هم جدا هستند. پوشش آزمون به‌معنای تضمین نبود تمام خطاهای ممکن یا ممیزی مستقل نیست.

| معیار | پوشش تحویل | شاهد |
|---|---|---|
| T01 | nonce یک‌بارمصرف، دامنه، callback و ورود Meteor بدون callback؛ شبکه فقط تست‌نت | auth.test.ts، production.test.ts، rpc.test.ts، wallet.spec.ts |
| T02 | جداسازی شرکت، فرد، دفتر شخصی و خروجی CSV | service.test.ts، live.test.ts، production.test.ts |
| T03 | حسابدار فقط پیش‌نویس؛ امضای مالی مالک | live.test.ts و کنترل OWNER_ONLY در Rust |
| T04 | نقش شغلی مستقل از عضویت و دسترسی | live.test.ts، ویرایش نقش بدون تغییر حقوق/مجوز |
| T05 | روز ۳۱، کبیسه و DST، تقویم IANA | domain.test.ts، forecast.test.ts |
| T06 | درصد/مبلغ، نقش/همه/انتخاب، تاریخ اثر و حفظ پاداش/پرداخت قبلی | service.test.ts، live.test.ts، workflows.spec.ts، LIVE_PRODUCT_SMOKE.json |
| T07 | تأمین کامل؛ درخواست AWAITING_FUNDS بدون اختیار ناقص | live.test.ts، requires_full_funding در Rust |
| T08 | رزرو کامل دسته و کنترل مجموع | LIVE_PRODUCT_SMOKE.json، ACCOUNTING_TESTNET_SMOKE.json |
| T09 | رد زودتر از موعد و اختیار منقضی؛ تمدید فقط مالک | آزمون‌های زمانی Rust و ACCOUNTING_TESTNET_SMOKE.json |
| T10 | شناسهٔ ثابت و اعتباردهی یک‌باره | service.test.ts، Rust و دو اجرای واقعی ACCOUNTING_TESTNET_SMOKE.json |
| T11 | جلوگیری از تخصیص دوباره با تغییر نسخه | service.test.ts، v1.test.ts |
| T12 | ثبت dispatch/عملیات، بازیابی projection پس از رسید و جلوگیری از امضای دوبارهٔ نتیجهٔ نامعلوم | live.test.ts، wallet.spec.ts؛ قطع برق واقعی همهٔ نقاط آزمایش نشده است |
| T13 | توقف بدهی را حذف نمی‌کند؛ مطالبه و برداشت شخصی مستقل | paused_employee_can_claim در Rust، live.test.ts، worker-selection.test.ts |
| T14 | callback موفق، شکست و تکرار | آزمون‌های بومی Rust، TESTNET_SMOKE.json |
| T15 | نتیجهٔ نامعلوم در انتظار می‌ماند و دوباره ارسال نمی‌شود | unknown_transfer_stays_reserved_and_cannot_be_resubmitted در Rust، live.test.ts |
| T16 | callback مستقیم خارجی رد می‌شود | callback_cannot_be_forged در Rust |
| T17 | رزرو حقوق/هدف قابل برداشت شرکت نیست | company_cannot_withdraw_reserved_salary و goal_reserves_cannot_be_withdrawn در Rust |
| T18 | جمع سهم‌ها با باقیماندهٔ نقد برابر ورودی است | domain.test.ts با BigInt |
| T19 | حداقل نقد و اولویت چند هدف | domain.test.ts، savings.test.ts و نمونه‌های مشترک |
| T20 | سقف تکمیل و مازاد نقد/هدف بعد | goal-vectors.json در TS و Rust |
| T21 | آزادسازی هدف تکمیل‌شده بدون فعال‌سازی خاموش | savings.test.ts، آزمون v2_goal_release در Rust |
| T22 | رزرو اتمی هدف و حفاظت نقد در برابر برداشت | funded_salary_allocates_goals_atomically و منع برداشت رزرو در Rust؛ تراکنش‌های قرارداد به‌ترتیب اجرا می‌شوند |
| T23 | پیش‌نمایش بدون تغییر مانده و برنامه | service.test.ts، forecast.test.ts، v1.test.ts |
| T24 | نسخه، موجودی، قیمت، تنظیمات و مقصد عوض شوند، تأیید تازه لازم است | service.test.ts، live.test.ts، v1.test.ts |
| T25 | نمونه‌های یکسان TS/Rust و گردکردن یکسان | هشت golden vector مشترک، savings.test.ts و Rust |
| T26 | کمبود بودجه، نوبت‌های تماماً ازدست‌رفته، تکرار و قفل worker | service.test.ts، v1.test.ts، worker-selection.test.ts؛ قفل پایدار SQLite و BEGIN IMMEDIATE |
| T27 | قیمت کهنه، انقضا، بدون مسیر، لغزش و سقف هزینه؛ حفظ بودجه | v1.test.ts، ScenarioCatalog، service.test.ts |
| T28 | قالب شبکه و مقصد متعلق به همان دفتر؛ ADDRESS_ONLY | service.test.ts، v1.test.ts؛ اتصال چندشبکه‌ای واقعی ادعا نمی‌شود |
| T29 | کاتالوگ عمومی فقط مرجع شبیه‌سازی و قیمت دقیق دارایی کم‌قیمت | v1.test.ts، production.test.ts؛ بدون ساخت تراکنش مین‌نت |
| T30 | reset دفتر شخصی مستقل؛ تاریخچه و زنجیره حفظ می‌شوند | v1.test.ts، production.test.ts |
| T31 | دریافت زودهنگام ۴۰۰ از ۱۰۰۰، کارمزد جدا و ماندهٔ ۶۰۰ | domain/service/v1 tests، workflows.spec.ts |
| T32 | پذیرش Hold نیازمند تمام ذخیرهٔ پاداش | service.test.ts |
| T33 | خروج زودتر، اصل را آزاد و پاداش کسب‌نشده را لغو می‌کند | service.test.ts، workflows.spec.ts |
| T34 | وام درآمد نیست؛ نقد، بدهی و ثروت خالص جدا هستند | service.test.ts، workflows.spec.ts |
| T35 | بهره و بازپرداخت تکراری ثبت نمی‌شوند | service.test.ts، v1.test.ts |
| T36 | افت وثیقه/درآمد و دادهٔ نامعتبر، مدل فرضی مشخص | financial-scenarios.ts، v1.test.ts و پنل شوکِ فقط‌خواندنی |
| T37 | مدل اختیار انتقال، shell و ابزار دلخواه ندارد؛ پیشنهاد تایپ‌شده و کنترل مجوز سرور | model.test.ts، v1.test.ts، production.test.ts و assistant در مرورگر |
| T38 | خاموشی مدل، فرم و محاسبه و زمان‌بند را متوقف نمی‌کند | model.test.ts، worker مستقل از مدل، فرم‌های مرورگر |
| T39 | بازیابی SQLite قدیمی، بازپخش یک‌باره و انسداد روی اختلاف | release-recovery.test.ts، backups.test.ts؛ worker قبل از ارسال تطبیق می‌کند |
| T40 | دفتر تغییرناپذیر، تراز، فیلتر/CSV و مانده‌های finalized | v1.test.ts، production.test.ts، release-recovery.test.ts، ACCOUNTING_TESTNET_SMOKE.json |
| T41 | شبکهٔ دیگر و اختیار مین‌نت رد می‌شود؛ تنظیمات مسیرِ ارسال ندارند | rpc.test.ts، schemaهای strict و آداپتور فقط شبیه‌سازی |
| T42 | رابط انگلیسی، مرز testNEAR/demoUSD و نمایش NEAR، موبایل و مسیرهای سه پنل | navigation/live/v1/wallet/workflows در سه دور مرورگر و بررسی تصاویر |

گزارش نهایی تعدادها در QA_REPORT.json است. فایل‌های آزمون واحد در tests و مرورگر در tests/e2e قرار دارند. گزارش‌های تست‌نت شامل هش عمومی رسید هستند؛ کلید خصوصی در آن‌ها نیست.

آزمون دستی انتخاب حساب و امضا در حساب شخصی کاربر، فشار طولانی‌مدت، تمام سناریوهای زندهٔ خطای شبکه و ممیزی امنیتی مستقل در این جدول به‌عنوان انجام‌شده معرفی نشده‌اند. امکانات شبیه‌سازی مصوب به اتصال واقعی مین‌نت تبدیل نشده‌اند.
