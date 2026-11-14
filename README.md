# 🎂 תזכורת ימי הולדת

אפליקציה למנהלים: תזכורת יומית על ימי הולדת של עובדים (Push או וואטסאפ).

## מבנה
| קובץ | תפקיד |
|---|---|
| `index.html` | כל המסכים והלוגיקה |
| `config.js` | הגדרות Firebase – **הקובץ היחיד שממלאים** |
| `manifest.json` | התקנה למסך הבית |
| `firebase-messaging-sw.js` | קבלת התראות כשהאפליקציה סגורה |
| `icon.png` | אייקון (מומלץ 512×512) |
| `database.rules.json` | כללי אבטחה לבסיס הנתונים |
| `functions/` | קוד השרת: התראה יומית ב-08:00 + התראת בדיקה |

## עדכון האפליקציה
```
git add .
git commit -m "תיאור השינוי"
git push origin main
```

## העלאת פונקציות השרת (מ-Google Cloud Shell)
```
git clone https://github.com/eliranshmilo-arch/birthday-reminder-app.git
cd birthday-reminder-app
cp functions/.env.example functions/.env   # ולמלא
cd functions && npm install && cd ..
firebase deploy --only functions,database
```
