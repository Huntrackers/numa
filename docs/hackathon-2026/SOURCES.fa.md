# منابع و حدود بررسی

بازبینی در ۶ نوامبر ۲۰۲۶ انجام شد. صفحهٔ اصلی، متن کامل راهنمای مسابقه و تمام ۱۳ prompt خوانده شدند. مستندات فنی مرتبط با کلیدها، قیمت، امضا و ابزارهای AI/دیفای مبنای تصمیم بودند. ادعای خواندن همهٔ صفحات تمام وب‌سایت‌های شرکا مطرح نمی‌شود.

## قواعد

- منبع [صفحهٔ اصلی](https://nearhackathon.com/): مسیرها، داورها، زمان‌بندی، فرم، اکوسیستم و راهنمای آمادگی داوری.
- منبع [راهنمای کامل](https://nearhackathon.com/HACKATHON.md): قواعد، ثبت، نشر، شبکه و محدودیت پروژه‌ها.
- منبع [مخزن مثال‌ها](https://github.com/nearai/near-hackathon-prompt-examples): ایده‌های شروع، نه الزام عمومی.

## تمام مثال‌های بررسی‌شده

- منبع [مثال ۱، defi](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/01-defi.md)
- منبع [مثال ۲، thesis](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/02-thesis.md)
- منبع [مثال ۳، privacy](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/03-privacy.md)
- منبع [مثال ۴، business](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/04-business.md)
- منبع [مثال ۵، swarms](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/05-swarms.md)
- منبع [مثال ۶، security](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/06-security.md)
- منبع [مثال ۷، agents](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/07-agents.md)
- منبع [مثال ۸، realworld](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/08-realworld.md)
- منبع [مثال ۹، games](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/09-games.md)
- منبع [مثال ۱۰، nfts](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/10-nfts.md)
- منبع [مثال ۱۱، memecoins](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/11-memecoins.md)
- منبع [مثال ۱۲، social](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/12-social.md)
- منبع [مثال ۱۳، open](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/13-open.md)

## منابع فنی اولیه

| تصمیم | منبع و نتیجه |
|---|---|
| قیمت فقط‌خواندنی | [معرفی 1Click](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/introduction) و [درخواست قیمت](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request): شناسهٔ دارایی از کاتالوگ، حالت dry و آدرس شبکهٔ واقعی |
| تأیید پاسخ | [امضای قیمت](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature): SDK رسمی، payload و timestamp بررسی می‌شوند |
| بدنه و کارمزد | [مرجع quote](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote): defaults و appFees پاسخ واقعی نمایش داده می‌شوند |
| اختیار محدود | [کلیدهای NEAR](https://docs.near.org/protocol/accounts-contracts/access-keys): receiver و method مشخص؛ full-access برای مجری خودکار رد می‌شود |
| گاز | [متاتراکنش](https://docs.near.org/web3-apps/tutorials/meta-transactions): این نسخه NEP-366 ندارد؛ پرداخت گاز مجری با gasless کاربر یکی نیست |
| مدل ابری | [شروع NEAR AI](https://docs.near.ai/cloud/quickstart) و [تأیید اجرا](https://docs.near.ai/cloud/verification): حساب و اعتبار نیاز است؛ مدل محلی ادعای TEE ندارد |
| اجرای ایجنت | [شروع OutLayer](https://app.outlayer.ai/docs/getting-started): پیکربندی و سرویس واقعی خودش را می‌خواهد؛ اتصال نمایشی وارد نشده است |
| وام | [راهنمای Rhea](https://guide.rhea.finance/): وثیقه، نرخ و خطر لیکوییدشدن واقعی‌اند؛ مدل آموزشی نوما تضمین یا HF واقعی پروتکل نیست |
| سایر زیرساخت‌ها | [Builders](https://nearbuilders.org/build)، [HOT](https://docs.hotdao.ai/) و [Aurora](https://doc.aurora.dev/): تناسب با دامنه بررسی شد؛ نام ابزار به‌معنای اتصال نیست |

اختلاف نرخ بدون JWT در راهنمای مسابقه و مستند جاری Intents ثبت شده است. UI به پاسخ امضاشده اتکا می‌کند. اسکیل نصب‌شده بر مستند رسمی، نتیجهٔ زنده یا محدودیت «بدون خرج مین‌نت» مقدم نیست.
