# نمایش و آماده‌سازی ثبت

نمایش محلی از دستور `npm run judge` روی پورت ۴۳۱۳ استفاده می‌کند. این محیط دیتابیس موقت دارد و کلید زمان‌بند تست‌نت نمی‌خواند. برنامهٔ اصلی با حساب‌های واقعی روی پورت ۴۳۱۰ مستقل باقی می‌ماند.

## روایت پیشنهادی ویدئو

۱. ابتدا صفحهٔ شواهد را باز کنید. مسئله را بگویید: شرکت باید حقوق را منظم بدهد، بدون اینکه اختیار نامحدود خزانه به مجری بدهد.
۲. با برچسب Simulation وارد شرکت نمونه شوید؛ اشخاص و نقش‌ها را ببینید، حقوق شتاب‌گرفته را پیش‌نمایش و تأیید کنید، سپس نتیجهٔ worker را در Payroll نشان دهید. این بخش، demoUSD ساختگی است.
۳. وارد کارمند نمونه شوید و هدف پس‌انداز، تخصیص حقوق و پیش‌نمایش تصمیم را نشان دهید. وام و DCA را فقط برنامه‌ریزی شبیه‌سازی معرفی کنید.
۴. در صفحهٔ شواهد، قرارداد تست‌نت، code hash و رسید تاریخی واقعی را نشان دهید. تصویر دفتر نمونه را به رسید واقعی نسبت ندهید.
۵. قیمت واقعی USDC از Base به NEAR را با آدرس‌های عمومی مستندات بگیرید؛ امضای تأییدشده، حداقل خروجی، کارمزد و انقضا را نشان دهید. پول منتقل نمی‌شود.
۶. سناریوی تغییر کد یا کلید نامحدود را در آزمایش سیاست باز کنید و BLOCK را نشان دهید. این سناریو مصنوعی است و حملهٔ زنده ارسال نمی‌کند.

فایل ویدئوی محلی در `qa/numa-v2-walkthrough.webm` و تصاویر نهایی در `qa/v2-*.png` قرار می‌گیرند. قبل از انتشار، نسخهٔ ویدئو را مرور و متن یا زیرنویس دلخواه را اضافه کنید. ویدئو به‌خودی‌خود پست عمومی X نیست.

## متن پیشنهادی انگلیسی برای پست

متن زیر پیش‌نویس است و منتشر نشده:

```text
Payroll should run on a schedule, without giving an agent the whole treasury.

We built numa at NEAR HACKATHON: bounded testnet payroll, salary-linked savings, and an execution policy you can inspect. The demo separates real NEAR receipts, live read-only Intents quotes, and simulated investing.

@NEARProtocol #NEARHackathon
```

پس از فراهم‌شدن لینک واقعی مخزن، آن را اضافه کنید. برای اجرای صرفاً محلی، طبق Q-012 ویدئو به پست پیوست شود؛ screenshot تنها کافی نیست. مالک پست را منتشر می‌کند. این تحویل هیچ پیام یا پستی از طرف کاربر ارسال نکرده است.

## توضیح پیشنهادی انگلیسی پروژه

```text
numa connects company payroll with employee savings on NEAR testnet. Companies define job roles and daily, weekly or monthly salaries, fund a bounded payroll mandate, and review bulk changes. A restricted function-call executor can only execute due obligations on the configured vault. The contract prevents duplicate credits and allocates employee savings atomically. Employees can claim eligible pay and withdraw through their own wallet. A shared execution guard checks network, method, receiver, accounting readiness and the reviewed contract hash. A public review center exposes deployment evidence, recorded receipts and reproducible policy drills. NEAR Intents provides live, signature-verified dry quote previews; no mainnet swap is sent. DCA, investing, Earn and loans remain clearly labelled simulations in a separate planning ledger. A keyless, temporary review workspace and automated checks make the project reproducible locally.
```

## گیت‌های پیش از ثبت

- کار انتشار: مخزن عمومی واقعی، حفظ تاریخچه، LICENSE و توضیح baseline/diff.
- کار رسانه: مرور ویدئو و انتشار پست عمومی توسط مالک، با عبارت ساخت در مسابقه و تگ‌های لازم.
- کار هویت: نام سرپرست، ایمیل، تعداد واقعی اعضا و حساب مین‌نت جایزه؛ هیچ‌کدام با حساب executor تست‌نت جایگزین نشوند.
- کار رضایت: مالک باید متن رسمی رضایت تماس را بخواند و بپذیرد. هیچ رضایت ضمنی ساخته نشده است.
- کار افشا: در صورت ارسال پروژهٔ مستقل دوم، نام واقعی آن طبق Q-015 در هر دو README درج شود.
- کار ثبت: payload نهایی با لینک‌های واقعی باید جدا بررسی شود؛ در این مرحله هیچ submission ارسال نشده است.

مهلت فعلی: ۱۴ نوامبر ۲۰۲۶، ساعت ۲۳:۵۹ UTC. نتیجه تا ۱۸ نوامبر اعلام می‌شود. قواعد را قبل از ثبت از [منبع رسمی](https://nearhackathon.com/HACKATHON.md) دوباره بخوانید.
