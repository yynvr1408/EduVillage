import json
from datetime import datetime, timedelta
from ..database.session import Base, engine, SessionLocal
from ..database.models import User, Course, Lesson, ClassRoom, Assignment, Submission, Summary, Material, Section, Recording, RecordingProgress
from .auth import get_password_hash


def seed_baseline(db, now):
    try:
        # Create Teacher
        teacher = User(
            email="teacher@eduvillage.org",
            full_name="Dr. Elena Rostova",
            role="teacher",
            hashed_password=get_password_hash("teacher123"),
        )
        db.add(teacher)

        # Create Student
        student = User(
            email="student@eduvillage.org",
            full_name="Amina Diallo",
            role="student",
            hashed_password=get_password_hash("student123"),
        )
        db.add(student)
        db.flush()

        # Course 1: Solar Micro-Grids
        c1 = Course(
            title="Solar Micro-Grids: Design & Maintenance",
            code="STEM-201",
            description="Practical engineering principles for solar-powered micro-grids in off-grid rural communities. Emphasizes battery life optimization, inverter selection, and field diagnostics under extreme temperatures.",
            teacher_id=teacher.id,
        )
        db.add(c1)
        db.flush()

        # Lessons for Course 1
        l1 = Lesson(
            course_id=c1.id,
            title="1. Photovoltaic Cell Physics & Irradiance Variation",
            description="Fundamental conversion of solar irradiance to direct current. Understanding how ambient temperature, angle of incidence, and dust accumulation affect voltage-current (I-V) curves.",
            order_index=1,
            content=r"""# Photovoltaic Cell Physics & Irradiance Variation

## 1. The P-N Junction Under Illumination
When photons with energy greater than the bandgap of silicon (~1.12 eV) strike the absorber layer, electron-hole pairs are generated. The built-in electric field of the p-n junction separates these charge carriers before recombination can occur.

$$I = I_{ph} - I_0 \left( e^{\frac{q(V + I R_s)}{n k T}} - 1 \right) - \frac{V + I R_s}{R_{sh}}$$

## 2. Temperature Coefficient Effects
As operating temperature increases above standard test conditions (25°C):
- Open-circuit voltage ($V_{oc}$) drops by approximately -0.35%/°C.
- Short-circuit current ($I_{sc}$) increases marginally (+0.05%/°C).
- Total peak power degrades noticeably in desert or tropical climates.

## 3. Practical Field Maintenance
- Inspect bypass diodes for reverse thermal breakdown every 6 months.
- Clean panel glass using dry microfiber during early morning hours to prevent thermal shock fractures.""",
            offline_ready=True,
        )
        l2 = Lesson(
            course_id=c1.id,
            title="2. Battery Chemistries: Lead-Carbon vs. LiFePO4",
            description="Comparative analysis of energy density, depth-of-discharge (DoD), round-trip efficiency, and thermal stability in off-grid energy storage.",
            order_index=2,
            content="""# Battery Chemistries: Lead-Carbon vs. LiFePO4

## 1. Chemical Composition & Cycle Life
Lithium Iron Phosphate (LiFePO4) offers 4,000+ cycles at 80% DoD, compared to ~1,500 cycles for premium Lead-Carbon. Despite higher initial capital expenditure, the levelized cost of storage (LCOS) over 10 years is significantly lower.

## 2. State of Charge (SoC) Drift
LiFePO4 displays a notoriously flat discharge curve between 20% and 80% SoC. Accurate monitoring requires shunt-based coulomb counting combined with resting voltage calibration.""",
            offline_ready=True,
        )
        l3 = Lesson(
            course_id=c1.id,
            title="3. Charge Controllers: PWM vs. MPPT Sizing",
            description="Matching array nominal voltage with battery bank requirements. Mathematical determination of maximum power point tracking efficiency under partial shading.",
            order_index=3,
            content="""# Charge Controllers: PWM vs MPPT Sizing

Maximum Power Point Tracking (MPPT) converters act as dynamic DC-DC buck converters, converting excess array voltage into additional charging current. In cold morning conditions, MPPT delivers up to 30% more energy into the storage bank than traditional PWM controllers.""",
            offline_ready=True,
        )
        db.add_all([l1, l2, l3])
        db.flush()

        # Materials for Course 1
        m1 = Material(
            course_id=c1.id,
            lesson_id=l1.id,
            title="Solar Field Diagnostics Guidebook (PDF)",
            file_url="/downloads/solar-diagnostics-guide.pdf",
            file_type="pdf",
            file_size=2450000,
            is_published=True,
        )
        m2 = Material(
            course_id=c1.id,
            lesson_id=l2.id,
            title="Battery Bank Sizing Calculator & Worksheet",
            file_url="/downloads/battery-sizing-worksheet.pdf",
            file_type="pdf",
            file_size=1120000,
            is_published=True,
        )
        m3 = Material(
            course_id=c1.id,
            lesson_id=l3.id,
            title="Audio Lecture: Inverter Troubleshooting in Extreme Heat",
            file_url="/downloads/inverter-troubleshooting.mp3",
            file_type="audio",
            file_size=6800000,
            is_published=True,
        )
        db.add_all([m1, m2, m3])

        # Classes for Course 1
        now = datetime.utcnow()
        cls_live = ClassRoom(
            course_id=c1.id,
            teacher_id=teacher.id,
            title="Field Diagnostics: Ground Faults & Inverter Calibration",
            status="LIVE",
            scheduled_at=now - timedelta(minutes=15),
            livekit_room_name="eduvillage-stem201-live",
            started_at=now - timedelta(minutes=15),
        )
        cls_scheduled = ClassRoom(
            course_id=c1.id,
            teacher_id=teacher.id,
            title="Live Lab: Sizing Charge Controllers for Variable Sunlight",
            status="SCHEDULED",
            scheduled_at=now + timedelta(hours=2),
            livekit_room_name="eduvillage-stem201-upcoming",
        )
        cls_ended = ClassRoom(
            course_id=c1.id,
            teacher_id=teacher.id,
            title="Battery Chemistries & Thermal Runaway Mitigation",
            status="ENDED",
            scheduled_at=now - timedelta(days=2),
            livekit_room_name="eduvillage-stem201-ended",
            started_at=now - timedelta(days=2, hours=1),
            ended_at=now - timedelta(days=2),
        )
        db.add_all([cls_live, cls_scheduled, cls_ended])
        db.flush()

        # AI Summary for Ended Class
        summary_ended = Summary(
            class_id=cls_ended.id,
            course_id=c1.id,
            status="COMPLETED",
            review_status="APPROVED",
            overview="This lecture examined energy storage selection for rural health clinics and educational facilities. Dr. Rostova evaluated thermal runaway dynamics, ventilation design, and why lithium iron phosphate (LiFePO4) is preferred over NMC cells in hot unconditioned shelters.",
            key_concepts=json.dumps([
                "Cathode crystal structure stability in Olivine LiFePO4 vs Layered Oxide NMC",
                "Thermal runaway onset thresholds (270°C for LiFePO4 vs 150°C for NMC)",
                "Passive cooling airflow calculations for containerized battery banks",
                "Battery Management System (BMS) low-temperature cut-off configurations"
            ]),
            definitions=json.dumps([
                {"term": "Thermal Runaway", "definition": "An uncontrollable self-heating reaction triggered by internal short circuits, mechanical damage, or overcharging."},
                {"term": "Depth of Discharge (DoD)", "definition": "The percentage of battery capacity that has been discharged relative to the overall capacity."},
                {"term": "Coulombic Efficiency", "definition": "The ratio of the total charge extracted during discharge to the total charge injected during recharge."}
            ]),
            examples=json.dumps([
                "Case Study: Solar clinic in Turkana County operating with dual 48V 100Ah LiFePO4 racks and temperature-controlled exhaust fans.",
                "Sizing Check: Ensuring minimum charging current of 0.2C to prevent premature cell capacity fading."
            ]),
            revision_questions=json.dumps([
                "Why is LiFePO4 considered significantly safer than cobalt-based lithium chemistries in ambient temperatures exceeding 40°C?",
                "What is the mathematical relationship between Depth of Discharge and expected operational cycle life?",
                "How should a technician test a battery module for internal short circuits without specialized laboratory equipment?"
            ]),
            teacher_notes="Approved with comprehensive revision questions for the upcoming assessment.",
        )

        # AI Summary needing review for the live class
        summary_review = Summary(
            class_id=cls_live.id,
            course_id=c1.id,
            status="NEEDS_REVIEW",
            review_status="PENDING",
            overview="Preliminary AI summary generated from current live session transcript. Focuses on field identification of DC isolation faults and multi-meter testing protocols.",
            key_concepts=json.dumps([
                "Megohmmeter isolation testing on ungrounded DC arrays",
                "Inverter error code 0x14 (Isolation Fault) troubleshooting",
                "Impact of humidity and morning dew on ground leakage current"
            ]),
            definitions=json.dumps([
                {"term": "Residual Current Device (RCD)", "definition": "A safety device that quickly breaks an electrical circuit to protect equipment and prevent electrocution."},
                {"term": "Galvanic Isolation", "definition": "The principle of isolating functional sections of electrical systems to prevent direct current flow between them."}
            ]),
            examples=json.dumps([
                "Example 1: Measuring positive-to-ground and negative-to-ground open circuit voltages."
            ]),
            revision_questions=json.dumps([
                "What voltage should be measured between positive terminal and earth ground on an ungrounded array with perfect insulation?",
                "Why do isolation errors frequently clear automatically as the sun dries early morning condensation?"
            ]),
            teacher_notes="Pending teacher review and final approval.",
        )
        db.add_all([summary_ended, summary_review])

        # Assignments for Course 1
        a1 = Assignment(
            course_id=c1.id,
            title="Rural Dispensary Solar Load & Sizing Calculation",
            instructions="""### Problem Statement
A remote health post requires continuous 24/7 electrical power for:
1. Vaccine refrigerator: 1.2 kWh / day (continuous compressor duty)
2. Examination room LED lights (4 × 15W): 6 hours / day
3. Diagnostic centrifuge (150W): 1.5 hours / day
4. Smartphone / tablet charging station (60W total): 4 hours / day

### Deliverables:
- Calculate total daily Watt-hour demand factoring in 15% inverter conversion loss.
- Determine required solar panel wattage assuming 4.5 peak sun hours and 20% dust derating factor.
- Specify battery storage capacity in Amp-hours (at 48V) for 2 days of autonomy at maximum 70% depth of discharge.
- Submit your step-by-step working and rationale below.""",
            due_date=now + timedelta(days=4),
            max_score=100,
        )
        a2 = Assignment(
            course_id=c1.id,
            title="Inverter Fault-Tree Diagnostic Strategy",
            instructions="Construct a 5-step diagnostic fault tree for an off-grid inverter displaying an over-temperature lockout alert despite clean cooling filters. Detail which physical and electrical measurements should be taken first.",
            due_date=now + timedelta(days=9),
            max_score=100,
        )
        db.add_all([a1, a2])

        # Course 2: Low-Bandwidth Web Architectures
        c2 = Course(
            title="Low-Bandwidth Web Architectures & Edge Sync",
            code="CS-304",
            description="Modern software engineering patterns for applications operating over intermittent, expensive, or high-latency cellular networks.",
            teacher_id=teacher.id,
        )
        db.add(c2)
        db.flush()

        l2_1 = Lesson(
            course_id=c2.id,
            title="1. Offline-First State Management with IndexedDB & Dexie",
            description="Client-side storage architecture, schema versioning, transaction boundaries, and quota management on constrained mobile hardware.",
            order_index=1,
            content="""# Offline-First Architecture

## 1. Storage Tiers
Browsers provide LocalStorage, CacheStorage, and IndexedDB. For binary assets and relational datasets, IndexedDB accessed through Dexie.js provides indexed querying, transactional integrity, and blob handling without blocking the main rendering thread.

## 2. Idempotent Synchronization
When clients transition between online and offline states, all mutations must be wrapped in idempotent operations with unique UUIDs. The backend verifies whether an operation was already applied before executing changes.""",
            offline_ready=True,
        )
        db.add(l2_1)

        db.commit()
        print("Database successfully seeded with demo teacher, student, courses, classes, assignments, and summaries!")
    except Exception as e:
        db.rollback()
        raise e


def init_db_and_seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        if db.query(User).first() is None:
            seed_baseline(db, now)

        # -------------------------------------------------------------
        # Seed Sections for multi-section course cohorts
        # -------------------------------------------------------------
        if db.query(Section).first() is None:
            c1 = db.query(Course).filter(Course.code == "STEM-201").first()
            c2 = db.query(Course).filter(Course.code == "CS-304").first()
            if c1:
                sec_1a = Section(id="sec-stem201-a", course_id=c1.id, name="Section A - Campus Lab Cohort", code="SEC-201A", student_count=28)
                sec_1b = Section(id="sec-stem201-b", course_id=c1.id, name="Section B - Northern Rural Outreach", code="SEC-201B", student_count=34)
                sec_1c = Section(id="sec-stem201-c", course_id=c1.id, name="Section C - Evening Distance Cohort", code="SEC-201C", student_count=19)
                db.add_all([sec_1a, sec_1b, sec_1c])
            if c2:
                sec_2a = Section(id="sec-cs304-a", course_id=c2.id, name="Section A - Systems Morning Track", code="SEC-304A", student_count=25)
                sec_2b = Section(id="sec-cs304-b", course_id=c2.id, name="Section B - Community Rural Cohort", code="SEC-304B", student_count=22)
                db.add_all([sec_2a, sec_2b])
            db.commit()

            # Assign sections to classes if not set
            cls_live = db.query(ClassRoom).filter(ClassRoom.status == "LIVE").first()
            cls_sched = db.query(ClassRoom).filter(ClassRoom.status == "SCHEDULED").first()
            cls_ended = db.query(ClassRoom).filter(ClassRoom.status == "ENDED").first()
            if cls_live:
                cls_live.section_id = "sec-stem201-a"
            if cls_sched:
                cls_sched.section_id = "sec-stem201-b"
            if cls_ended:
                cls_ended.section_id = "sec-stem201-a"
            db.commit()

        # -------------------------------------------------------------
        # Seed Recorded Classes (distinct from AI summaries)
        # -------------------------------------------------------------
        if db.query(Recording).first() is None:
            c1 = db.query(Course).filter(Course.code == "STEM-201").first()
            teacher = db.query(User).filter(User.role == "teacher").first()
            cls_ended = db.query(ClassRoom).filter(ClassRoom.status == "ENDED").first()
            summary_ended = db.query(Summary).filter(Summary.status == "COMPLETED").first()

            if c1 and teacher:
                # 1. Complete ready lecture recording with transcript and approved summary
                r1 = Recording(
                    id="rec-stem201-01",
                    course_id=c1.id,
                    class_id=cls_ended.id if cls_ended else None,
                    teacher_id=teacher.id,
                    title="Battery Chemistries & Thermal Runaway Mitigation",
                    description="Detailed analysis of LiFePO4 vs NMC cathode structures, thermal runaway thresholds, and active vs passive cooling in hot climates.",
                    duration_seconds=2420,
                    video_url="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
                    download_url="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
                    file_size_bytes=185000000,
                    status="READY",
                    transcript="""Good morning everyone. Today we are addressing one of the most critical engineering choices for rural community clinics: energy storage chemistry.

When an unconditioned solar battery room reaches 45 degrees Celsius, standard lithium nickel manganese cobalt (NMC) cells become volatile. In contrast, lithium iron phosphate (LiFePO4) utilizes an olivine crystal structure with strongly bonded P-O covalent bonds.

This chemical bond prevents spontaneous oxygen release until temperatures exceed 270 degrees Celsius. Therefore, even under external short circuits or ventilation fan failures, LiFePO4 will not undergo catastrophic self-propagating thermal runaway.

Next, we look at Depth of Discharge. Sizing a lead-carbon bank requires limiting DoD to 50% to achieve acceptable cycle life. With LiFePO4, we can routinely cycle to 80% DoD, dramatically reducing the raw battery capacity required for the same usable kWh demand.""",
                    summary_id=summary_ended.id if summary_ended else None,
                    section_ids=json.dumps(["sec-stem201-a", "sec-stem201-b"]),
                    is_published=True,
                )

                # 2. Second ready lecture recording with transcript
                r2 = Recording(
                    id="rec-stem201-02",
                    course_id=c1.id,
                    teacher_id=teacher.id,
                    title="Photovoltaic Cell Physics & Irradiance Variation",
                    description="Comprehensive breakdown of silicon p-n junctions under tropical illumination, temperature coefficients, and bypass diode diagnostics.",
                    duration_seconds=3100,
                    video_url="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
                    download_url="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
                    file_size_bytes=215000000,
                    status="READY",
                    transcript="""Welcome back. In this lecture we explore why standard laboratory ratings do not match actual output in sub-Saharan installations.

Standard test conditions assume a cell temperature of 25 degrees Celsius and 1000 watts per square meter of irradiance. In the field, panels frequently heat up to 65 degrees Celsius.

Every degree Celsius increase over 25 causes silicon open-circuit voltage to decline by approximately -0.35 percent. Over a 40 degree delta, you lose over 14 percent of your nominal operating voltage. If your charge controller requires a minimum voltage headroom over the battery bank, charging can shut down prematurely in the middle of a sunny afternoon.""",
                    section_ids=json.dumps(["sec-stem201-a", "sec-stem201-b", "sec-stem201-c"]),
                    is_published=True,
                )

                # 3. Third lecture recording in PROCESSING state (demonstrating processing state feedback)
                r3 = Recording(
                    id="rec-stem201-03",
                    course_id=c1.id,
                    teacher_id=teacher.id,
                    title="Live Lab Troubleshooting: Ground Faults & Isolation Diagnostics",
                    description="Field demo recording captured during morning dew conditions demonstrating insulation resistance testing on ungrounded arrays.",
                    duration_seconds=1800,
                    video_url=None,
                    download_url=None,
                    file_size_bytes=142000000,
                    status="PROCESSING",
                    transcript=None,
                    section_ids=json.dumps(["sec-stem201-a"]),
                    is_published=False,
                )

                db.add_all([r1, r2, r3])
                db.commit()
                print("Seeded 3 lecture recordings (2 READY, 1 PROCESSING) and multi-section cohorts!")
    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
    finally:
        db.close()
