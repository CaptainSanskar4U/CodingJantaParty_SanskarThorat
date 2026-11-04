import time
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1600, "height": 950})

        # -------------------------------------------------------------
        # Tab 1: Operator Dashboard
        # -------------------------------------------------------------
        print("1. Opening Operator Dashboard in Tab 1...")
        dashboard = context.new_page()
        dashboard.goto("http://localhost:3000/")
        dashboard.wait_for_timeout(1500)

        # Check Active Extension
        ext_el = dashboard.locator("header span.font-mono.text-lg")
        initial_ext = ext_el.inner_text().strip()
        print(f"   Active Extension displayed on Dashboard: '{initial_ext}'")
        assert len(initial_ext) >= 3, "Extension should be at least 3 digits"

        # Capture Dashboard Ready Screenshot
        screenshot_ready = r"C:\Users\Captain\.gemini\antigravity\brain\4cd2bc6c-8c6c-4f34-a102-609264452efe\telephony_dashboard_ready.png"
        dashboard.screenshot(path=screenshot_ready, full_page=True)
        print(f"   Captured screenshot: {screenshot_ready}")

        # -------------------------------------------------------------
        # Tab 2: Mobile Smartphone Dialer
        # -------------------------------------------------------------
        print(f"2. Opening Mobile Dialer in Tab 2 to dial extension {initial_ext}...")
        mobile = context.new_page()
        mobile.set_viewport_size({"width": 450, "height": 850})
        mobile.goto("http://localhost:3000/dialer")
        mobile.wait_for_timeout(1200)

        # Type each digit of the extension on the keypad
        for digit in initial_ext:
            btn = mobile.locator(f"button:has-text('{digit}')").first
            btn.click()
            mobile.wait_for_timeout(100)

        # Capture Mobile Dialer Typed Screenshot
        screenshot_dialer = r"C:\Users\Captain\.gemini\antigravity\brain\4cd2bc6c-8c6c-4f34-a102-609264452efe\telephony_mobile_dialer.png"
        mobile.screenshot(path=screenshot_dialer)
        print(f"   Captured screenshot: {screenshot_dialer}")

        # Press Green Call Button
        print("   Initiating call from mobile dialer...")
        call_btn = mobile.locator("button.bg-emerald-600").first
        call_btn.click()
        mobile.wait_for_timeout(1000)

        # -------------------------------------------------------------
        # Verify Incoming Call Alert on Dashboard (Tab 1)
        # -------------------------------------------------------------
        print("3. Checking incoming call notification on Dashboard...")
        dashboard.wait_for_selector("div.fixed.inset-0:has-text('Incoming Phone Call')", state="visible", timeout=6000)
        print("   Incoming Call Modal successfully triggered on dashboard!")

        screenshot_ringing = r"C:\Users\Captain\.gemini\antigravity\brain\4cd2bc6c-8c6c-4f34-a102-609264452efe\telephony_incoming_call_alert.png"
        dashboard.screenshot(path=screenshot_ringing, full_page=True)
        print(f"   Captured screenshot: {screenshot_ringing}")

        # -------------------------------------------------------------
        # Answer Call on Dashboard (Tab 1)
        # -------------------------------------------------------------
        print("4. Answering incoming call on Operator Dashboard...")
        answer_btn = dashboard.locator("button:has-text('Answer Call')")
        answer_btn.click()
        dashboard.wait_for_timeout(1500)

        # -------------------------------------------------------------
        # Simulate Live Conversation & Real-Time AI Analysis
        # -------------------------------------------------------------
        print("5. Transmitting live conversation utterances...")
        
        input_box = dashboard.locator("input[placeholder*='speech']")
        speaker_btn = dashboard.locator("button:has-text('Caller'), button:has-text('Operator')").first

        # Utterance 1 (Caller)
        input_box.fill("Hello, I would like to order a large pepperoni pizza to apartment 302.")
        input_box.press("Enter")
        dashboard.wait_for_timeout(1500)

        # Switch to Operator & Utterance 2
        speaker_btn.click()
        dashboard.wait_for_timeout(300)
        input_box.fill("Ma'am, this is the emergency line. Is someone preventing you from speaking freely?")
        input_box.press("Enter")
        dashboard.wait_for_timeout(1500)

        # Switch back to Caller & Utterance 3
        speaker_btn.click()
        dashboard.wait_for_timeout(300)
        input_box.fill("Please send the pizza fast, there are two people here and I cannot leave.")
        input_box.press("Enter")
        dashboard.wait_for_timeout(2000)

        # -------------------------------------------------------------
        # Verify Real-Time AI Insights
        # -------------------------------------------------------------
        print("6. Verifying live transcript and real-time AI insight cards...")
        transcript_count = dashboard.locator("div.p-4.overflow-y-auto div.flex.gap-3").count()
        print(f"   Rendered transcript entries: {transcript_count}")
        assert transcript_count >= 3, "Expected at least 3 transcript entries"

        # Check Urgency Badge
        urgency_text = dashboard.locator("span:has-text('CRITICAL')").first.inner_text()
        print(f"   AI Detected Urgency Level: '{urgency_text}'")
        assert "CRITICAL" in urgency_text, "Expected CRITICAL urgency level"

        # Check Sentiment Badge
        sentiment_text = dashboard.locator("span:has-text('Distressed')").first.inner_text()
        print(f"   AI Detected Sentiment: '{sentiment_text}'")
        assert "Distressed" in sentiment_text, "Expected Distressed sentiment"

        # Capture Active Live Call & AI Insights Screenshot
        screenshot_active = r"C:\Users\Captain\.gemini\antigravity\brain\4cd2bc6c-8c6c-4f34-a102-609264452efe\telephony_active_call_ai_insights.png"
        dashboard.screenshot(path=screenshot_active, full_page=True)
        print(f"   Captured screenshot: {screenshot_active}")

        # Also capture Mobile In-Call Screen
        screenshot_mobile_incall = r"C:\Users\Captain\.gemini\antigravity\brain\4cd2bc6c-8c6c-4f34-a102-609264452efe\telephony_mobile_incall_screen.png"
        mobile.screenshot(path=screenshot_mobile_incall)
        print(f"   Captured screenshot: {screenshot_mobile_incall}")

        # -------------------------------------------------------------
        # End Call from Mobile
        # -------------------------------------------------------------
        print("7. Ending call from mobile dialer...")
        mobile_hangup = mobile.locator("button.bg-rose-600").first
        mobile_hangup.click()
        mobile.wait_for_timeout(1500)

        # -------------------------------------------------------------
        # Verify Call Statistics & History Modal (Tab 1)
        # -------------------------------------------------------------
        print("8. Opening Call Statistics Modal on Dashboard...")
        stats_btn = dashboard.locator("button:has-text('Calls:')")
        stats_btn.click()
        dashboard.wait_for_selector("h2:has-text('Call Center Statistics')", state="visible", timeout=4000)
        dashboard.wait_for_timeout(1000)

        screenshot_stats = r"C:\Users\Captain\.gemini\antigravity\brain\4cd2bc6c-8c6c-4f34-a102-609264452efe\telephony_call_statistics_modal.png"
        dashboard.screenshot(path=screenshot_stats, full_page=True)
        print(f"   Captured screenshot: {screenshot_stats}")

        browser.close()
        print("\nALL VERIFICATIONS PASSED CLEANLY & SUCCESSFULLY!")

if __name__ == "__main__":
    run()
