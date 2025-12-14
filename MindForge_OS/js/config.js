// js/config.js
const SUPABASE_URL = 'https://fjuxtlzbeeexyczfrqsq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqdXh0bHpiZWVleHljemZycXNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1ODQ0MTAsImV4cCI6MjA4MTE2MDQxMH0.TaaEJpNcDIWyVbpxKZpcy23cjFvns8InmMQ2TISA9pI' 

// 初始化并挂载
if (window.supabase) {
    window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true }
    });
    console.log("MindForge Core: Database Initialized.");
} else {
    console.error("Error: Supabase SDK not found. Check your CDN links.");
}