// =====================================================
//  הגדרות Firebase – זה הקובץ היחיד שצריך למלא
// =====================================================

var firebaseConfig = {
  apiKey: "AIzaSyB-d7hyJlvWHYq2Tea0GAXZA5892JbEbdM",
  authDomain: "birthday-reminder-bef33.firebaseapp.com",
  databaseURL: "https://birthday-reminder-bef33-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "birthday-reminder-bef33",
  storageBucket: "birthday-reminder-bef33.firebasestorage.app",
  messagingSenderId: "552498896780",
  appId: "1:552498896780:web:a0fc9dc18857316c8b00a9"
};

// מפתח VAPID – מ-Project settings > Cloud Messaging > Web Push certificates
var VAPID_KEY = "BHM97Yu7zdqkX4wkgwur9fWWBGYvsReeLQhhzR5WxzWV552wH4_wDKcDvVpegrxVt7Osfnrv0-w3Q2lJ7znNBgs";

// האזור שבו רצות הפונקציות (לא לשנות)
var FUNCTIONS_REGION = "europe-west1";