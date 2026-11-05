import cv2
import numpy as np
import os
import sys
import subprocess
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
RECORDINGS_DIR = os.path.join(ROOT_DIR, "deliverables", "raw_recordings")
VOICEOVER_DIR = os.path.join(ROOT_DIR, "deliverables", "voiceover", "stems")
ASSETS_DIR = os.path.join(ROOT_DIR, "deliverables", "assets")
TEMP_DIR = os.path.join(RECORDINGS_DIR, "temp_render")
OUTPUT_DIR = os.path.join(ROOT_DIR, "deliverables")

os.makedirs(TEMP_DIR, exist_ok=True)

FFMPEG = r"C:\ProgramData\chocolatey\bin\ffmpeg.EXE"

FONT_PATH_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
FONT_PATH_REG = r"C:\Windows\Fonts\segoeui.ttf"

font_sub = ImageFont.truetype(FONT_PATH_BOLD, 26)
font_badge = ImageFont.truetype(FONT_PATH_BOLD, 17)

def ease_in_out(t):
    return t * t * (3 - 2 * t)

def apply_camera(frame, zoom, cx, cy, out_w=1920, out_h=1080):
    if zoom <= 1.002:
        return frame

    crop_w = int(out_w / zoom)
    crop_h = int(out_h / zoom)

    x1 = int(cx - crop_w / 2)
    y1 = int(cy - crop_h / 2)

    x1 = max(0, min(x1, out_w - crop_w))
    y1 = max(0, min(y1, out_h - crop_h))

    cropped = frame[y1:y1 + crop_h, x1:x1 + crop_w]
    return cv2.resize(cropped, (out_w, out_h), interpolation=cv2.INTER_CUBIC)

def overlay_hud(frame_bgr, act_text, subtitle_text):
    if not act_text and not subtitle_text:
        return frame_bgr

    img = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(img, "RGBA")

    # 1. Top-Left Act Badge
    if act_text:
        badge_pad_x = 16
        badge_pad_y = 8
        bbox = font_badge.getbbox(act_text)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]

        bx1, by1 = 45, 35
        bx2, by2 = bx1 + tw + badge_pad_x * 2 + 18, by1 + th + badge_pad_y * 2

        draw.rounded_rectangle([bx1, by1, bx2, by2], radius=14, fill=(12, 16, 26, 230), outline=(255, 50, 75, 190), width=2)
        dot_r = 4
        draw.ellipse([bx1 + 13 - dot_r, by1 + 14 - dot_r, bx1 + 13 + dot_r, by1 + 14 + dot_r], fill=(255, 45, 65, 255))
        draw.text((bx1 + 25, by1 + badge_pad_y - 2), act_text, font=font_badge, fill=(245, 248, 255, 255))

    # 2. Bottom-Center Subtitle Pill
    if subtitle_text:
        pad_x = 26
        pad_y = 11
        bbox = font_sub.getbbox(subtitle_text)
        stw = bbox[2] - bbox[0]
        sth = bbox[3] - bbox[1]

        sx1 = int((1920 - (stw + pad_x * 2)) / 2)
        sy1 = 1080 - 80
        sx2 = sx1 + stw + pad_x * 2
        sy2 = sy1 + sth + pad_y * 2

        draw.rounded_rectangle([sx1, sy1, sx2, sy2], radius=16, fill=(8, 12, 20, 235), outline=(255, 255, 255, 75), width=1)
        draw.text((sx1 + pad_x, sy1 + pad_y - 3), subtitle_text, font=font_sub, fill=(255, 255, 255, 255))

    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

def render_act_video(src_video_path, out_video_path, target_duration, act_badge, camera_keyframes, subtitle_schedule):
    print(f"\nProcessing {os.path.basename(out_video_path)} (Target: {target_duration:.2f}s)...")
    cap = cv2.VideoCapture(src_video_path)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    src_total_frames = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))

    out_fps = 60.0
    out_total_frames = int(target_duration * out_fps)

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(out_video_path, fourcc, out_fps, (1920, 1080))

    ret, first_frame = cap.read()
    if not ret or first_frame is None:
        print(f"ERROR: Could not read first frame from {src_video_path}")
        cap.release()
        out.release()
        return

    last_frame = first_frame
    curr_src_idx = 0

    print(f"  Streaming {src_total_frames} source frames -> {out_total_frames} output frames @ 60fps...")

    for f_idx in range(out_total_frames):
        t = f_idx / out_fps
        target_src_idx = int(f_idx * (src_total_frames / out_total_frames))

        # Advance video capture to target_src_idx
        while curr_src_idx < target_src_idx:
            ret, next_frame = cap.read()
            if ret and next_frame is not None:
                last_frame = next_frame
                curr_src_idx += 1
            else:
                break

        # Determine camera zoom & center
        zoom = 1.0
        cx = 960.0
        cy = 540.0
        for k in range(len(camera_keyframes) - 1):
            t1, z1, x1, y1 = camera_keyframes[k]
            t2, z2, x2, y2 = camera_keyframes[k + 1]
            if t1 <= t <= t2:
                p = (t - t1) / max(0.001, (t2 - t1))
                ep = ease_in_out(p)
                zoom = z1 + ep * (z2 - z1)
                cx = x1 + ep * (x2 - x1)
                cy = y1 + ep * (y2 - y1)
                break
            elif t > camera_keyframes[-1][0]:
                _, zoom, cx, cy = camera_keyframes[-1]

        # Apply camera crop & resize
        framed = apply_camera(last_frame, zoom, cx, cy)

        # Determine subtitle
        current_sub = ""
        for s_start, s_end, text in subtitle_schedule:
            if s_start <= t <= s_end:
                current_sub = text
                break

        # Overlay HUD
        final_frame = overlay_hud(framed, act_badge, current_sub)
        out.write(final_frame)

    cap.release()
    out.release()
    print(f"  ✓ Saved {os.path.basename(out_video_path)} ({os.path.getsize(out_video_path):,} bytes)")

def main():
    print("=" * 60)
    print("STARTING AI CINEMATIC DIRECTOR & AUTO-ZOOM MASTER PIPELINE")
    print("=" * 60)

    # 1. ACT I: THE ANATOMY OF SILENCE (29.76s)
    cam_act1 = [(0.0, 1.0, 960, 540), (29.76, 1.12, 960, 540)]
    subs_act1 = [
        (0.0, 7.5, "Every day across India, emergency 112 control rooms receive calls where the caller cannot speak freely."),
        (7.5, 14.5, "An intruder in the home. A hostage held under watch."),
        (14.5, 22.0, "A domestic abuse victim forced to pretend they are ordering a pizza on an emergency frequency."),
        (22.0, 29.76, "Traditional dispatch desks listen only to words. But when danger forces silence... words are the first thing taken away.")
    ]
    render_act_video(
        os.path.join(RECORDINGS_DIR, "clip_01_crisis.webm"),
        os.path.join(TEMP_DIR, "director_act1.mp4"),
        29.76,
        "ACT I · THE ANATOMY OF SILENCE",
        cam_act1,
        subs_act1
    )

    # 2. ACT II: THE PARADIGM SHIFT (36.20s)
    cam_act2 = [
        (0.0, 1.0, 960, 540),
        (12.0, 1.05, 960, 540),
        (24.0, 1.10, 960, 540),
        (36.20, 1.0, 960, 540)
    ]
    subs_act2 = [
        (0.0, 7.5, "This is Dhvani: Multi-dimensional emergency response intelligence designed for control room investigators."),
        (7.5, 16.5, "Dhvani is built on a fundamental truth: human distress cannot hide its acoustics."),
        (16.5, 25.5, "Fear changes vocal fold tension. Duress forces micro-tremors in pitch. And the background holds forensic proof."),
        (25.5, 36.20, "Dhvani does not replace human judgment. It gives investigators the eyes to see what the ears alone could miss.")
    ]
    render_act_video(
        os.path.join(RECORDINGS_DIR, "clip_02_landing.webm"),
        os.path.join(TEMP_DIR, "director_act2.mp4"),
        36.20,
        "ACT II · THE PARADIGM SHIFT",
        cam_act2,
        subs_act2
    )

    # 3. ACT III: OPERATIONS CONSOLE (21.89s)
    cam_act3 = [
        (0.0, 1.0, 960, 540),
        (3.5, 1.0, 960, 540),
        (7.0, 1.55, 360, 360),
        (11.0, 1.55, 360, 360),
        (15.0, 1.45, 960, 280),
        (18.0, 1.55, 1550, 350),
        (21.89, 1.55, 1550, 350)
    ]
    subs_act3 = [
        (0.0, 7.0, "Inside the operations console, chaos becomes structured intelligence."),
        (7.0, 14.0, "Incoming incidents are automatically triage-ranked by urgency rather than simple arrival time."),
        (14.0, 21.89, "Every stream is processed 100% locally on CPU—guaranteeing zero cloud leakage and cryptographic evidence integrity.")
    ]
    render_act_video(
        os.path.join(RECORDINGS_DIR, "clip_03_console.webm"),
        os.path.join(TEMP_DIR, "director_act3.mp4"),
        21.89,
        "ACT III · MISSION CONTROL CONSOLE",
        cam_act3,
        subs_act3
    )

    # 4. ACT IV: LIVE TELEPHONY DEMO (46.20s) - THE CLIMAX
    cam_act4 = [
        (0.0, 1.0, 960, 540),
        (5.0, 1.0, 960, 540),
        (7.5, 1.40, 680, 240),
        (10.5, 1.40, 680, 240),
        (13.5, 1.70, 1550, 350),
        (22.0, 1.70, 1550, 350),
        (25.0, 1.65, 1550, 550),
        (33.0, 1.65, 1550, 550),
        (36.0, 1.75, 1550, 680),
        (41.0, 1.75, 1550, 680),
        (43.0, 1.60, 1550, 900),
        (46.20, 1.15, 960, 540)
    ]
    subs_act4 = [
        (0.0, 5.5, "Watch a live emergency unfold on the telephony stream."),
        (5.5, 13.5, "A civilian dials 112 pretending to place a pizza delivery order. An ordinary operator might dismiss it."),
        (13.5, 22.0, "Dhvani immediately isolates laryngeal micro-tremors in the voice, detecting acute physiological tension."),
        (22.0, 30.5, "As the caller repeats the food script, the keyword engine confirms covert duress while background DSP detects pacing footsteps."),
        (30.5, 39.0, "The AI Copilot guides the operator to discreet yes-or-no safety protocols without alerting the perpetrator."),
        (39.0, 46.20, "Extracting the address—Dadar West, Apartment 302—tactical dispatch is staged in under 35 seconds.")
    ]
    render_act_video(
        os.path.join(RECORDINGS_DIR, "clip_04_livedemo.webm"),
        os.path.join(TEMP_DIR, "director_act4.mp4"),
        46.20,
        "ACT IV · LIVE TELEPHONY & COVERT DURESS",
        cam_act4,
        subs_act4
    )

    # 5. ACT V: REAL-TIME TRANSLATION & AI FORENSICS (34.15s)
    cam_act5 = [
        (0.0, 1.0, 960, 540),
        (2.5, 1.65, 680, 560),
        (12.0, 1.65, 680, 560),
        (15.0, 1.50, 960, 460),
        (22.0, 1.50, 960, 460),
        (25.0, 1.35, 960, 540),
        (34.15, 1.35, 960, 540)
    ]
    subs_act5 = [
        (0.0, 8.0, "Engineering this required zero compromises. Citizen audio never leaves the department machine."),
        (8.0, 17.0, "Sub-90 millisecond translation bridges Indian language barriers instantly—translating Hindi, Marathi, and Tamil in real time."),
        (17.0, 26.0, "Local CPU-first DSP extracts acoustic scene fingerprints—identifying footsteps, room reverberation, and glottal stress."),
        (26.0, 34.15, "Observable scientific measurements for human decision support—never automated hallucinations.")
    ]
    render_act_video(
        os.path.join(RECORDINGS_DIR, "clip_05_translation_audio.webm"),
        os.path.join(TEMP_DIR, "director_act5.mp4"),
        34.15,
        "ACT V · 2-WAY TRANSLATION & ACOUSTIC FORENSICS",
        cam_act5,
        subs_act5
    )

    # 6. ACT VI: THE DHVANI VERDICT (15.44s)
    cam_act6 = [(0.0, 1.0, 960, 540), (15.44, 1.10, 960, 540)]
    subs_act6 = [
        (0.0, 5.5, "In an emergency, there is no time to decode ambiguity."),
        (5.5, 10.5, "There is only the voice, the silence, and the truth hidden in the sound."),
        (10.5, 15.44, "Dhvani ensures that when lives hang in the balance... someone is truly listening.")
    ]
    render_act_video(
        os.path.join(RECORDINGS_DIR, "clip_06_coda.webm"),
        os.path.join(TEMP_DIR, "director_act6.mp4"),
        15.44,
        "ACT VI · THE DHVANI VERDICT",
        cam_act6,
        subs_act6
    )

    print("\n" + "=" * 60)
    print("ALL 6 DIRECTED ACTS RENDERED WITH DYNAMIC CAMERA TRACKING & HUD!")
    print("=" * 60)

    # Convert each director_act_X.mp4 into H.264 MP4 with FFmpeg for clean concatenation
    directed_acts = [
        os.path.join(TEMP_DIR, f"director_act{i}.mp4") for i in range(1, 7)
    ]
    h264_acts = []
    for i, d_path in enumerate(directed_acts, 1):
        h_path = os.path.join(TEMP_DIR, f"h264_act{i}.mp4")
        cmd = [
            FFMPEG, "-y",
            "-i", d_path,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "17",
            "-pix_fmt", "yuv420p",
            h_path
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        h264_acts.append(h_path)

    # Concatenate visual tracks
    concat_list_path = os.path.join(TEMP_DIR, "concat_director.txt")
    with open(concat_list_path, "w", encoding="utf-8") as f:
        for h_path in h264_acts:
            f.write(f"file '{h_path.replace(os.sep, '/')}'\n")

    master_visuals = os.path.join(TEMP_DIR, "master_director_visuals.mp4")
    concat_cmd = [
        FFMPEG, "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_list_path,
        "-c", "copy",
        master_visuals
    ]
    subprocess.run(concat_cmd, check=True, capture_output=True)

    # Audio Mastering & Dynamic Ducking
    full_voice_temp = os.path.join(TEMP_DIR, "full_narration_track.wav")
    soundtrack_path = os.path.join(ASSETS_DIR, "cinematic_soundtrack.wav")
    master_output = os.path.join(OUTPUT_DIR, "Dhvani_Cinematic_Demo_1080p.mp4")

    filter_complex = (
        "[1:a]highpass=f=80,equalizer=f=3000:width_type=q:width=1.2:g=1.5,volume=1.25,asplit=2[voice_sc][voice_main];"
        "[2:a]volume=0.32[music_pre];"
        "[music_pre][voice_sc]sidechaincompress=threshold=0.035:ratio=4:attack=150:release=700[ducked_music];"
        "[ducked_music][voice_main]amix=inputs=2:duration=first:dropout_transition=2:weights=1.0 1.0[mixed_audio];"
        "[mixed_audio]alimiter=limit=0.95:level=true[master_audio]"
    )

    final_cmd = [
        FFMPEG, "-y",
        "-i", master_visuals,
        "-i", full_voice_temp,
        "-i", soundtrack_path,
        "-filter_complex", filter_complex,
        "-map", "0:v",
        "-map", "[master_audio]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "320k",
        "-ar", "48000",
        "-shortest",
        "-movflags", "+faststart",
        master_output
    ]

    print("\nRendering Master Video with Broadcast Sidechain Ducking...")
    subprocess.run(final_cmd, check=True)

    final_size = os.path.getsize(master_output)
    print("\n" + "=" * 60)
    print("MASTER CINEMATIC DEMO VIDEO UPGRADED & MASTERED SUCCESSFULLY!")
    print(f"Path: {master_output}")
    print(f"Size: {final_size / (1024*1024):.2f} MB")
    print("=" * 60)

if __name__ == "__main__":
    main()
