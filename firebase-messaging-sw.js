// קובץ זה מקבל התראות Push גם כשהאפליקציה סגורה.
// אין צורך לערוך אותו – ההגדרות נטענות מ-config.js
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');
importScripts('config.js');

firebase.initializeApp(firebaseConfig);
firebase.messaging();
