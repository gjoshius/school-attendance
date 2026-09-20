-- Backfills attendance for the Gita class session on Saturday 2026-09-12,
-- transcribed from the physical sign-in sheets (3 pages) plus the confirmed
-- handwritten walk-ins -- see data_import/gita_attendance_last_saturday.xlsx
-- for the full consolidated record this was built from.
--
-- 79 students total: 76 from the printed Gita roster (25 marked present)
-- plus 3 of the 4 confirmed walk-ins (Sudheeksha Vennu, Deetya Sri
-- Kadiyala, Vihaan Vennu -- all marked present, matched by their real
-- database names, not the paper's spelling). "Divisha" (5th Grade,
-- handwritten walk-in) is deliberately excluded -- her full name/database
-- record hasn't been confirmed yet, add her in a follow-up once she is.
--
-- Every statement below is fully self-contained (the paper roster is
-- inlined as a VALUES list in each one via a subquery, not a temp table --
-- an earlier version of this file used `create temporary table` and hit
-- "relation does not exist" on the very next statement, because the SQL
-- editor doesn't guarantee the same session/connection across separate
-- statements). That means each of the numbered steps below can be run on
-- its own, in any order, and re-run safely.
--
-- *** BEFORE RUNNING STEP 4: confirm the email below is who should be
-- recorded as having taken this attendance (marked_by). Defaults to
-- Gaurav's own admin account since he's the one backfilling this
-- historical data -- change 'gjoshius@gmail.com' to the actual Gita
-- teacher's email if you'd rather attribute it to them.

-- ===== STEP 1: sanity checks -- each must return exactly one row =====
select id from profiles where lower(email) = lower('gjoshius@gmail.com');
select id from classes where name = 'Gita';

-- ===== STEP 2: names that do NOT match any student (must be empty) =====
-- If anything comes back here, that student's attendance was NOT
-- recorded by STEP 4 -- a spelling mismatch between the paper and the
-- database, the same kind of gap this whole investigation started from.
select p.full_name, p.grade_level
from
(
  values
    ('Aarya Datar', '3rd Grade', 'present'),
    ('Ananya Sai Moddu', '3rd Grade', 'present'),
    ('Jatin Nunna', '3rd Grade', 'absent'),
    ('Lakshmi Mahanya Pokuru', '3rd Grade', 'absent'),
    ('Misheeta Reddy Palli', '3rd Grade', 'present'),
    ('Rohita Prathi', '3rd Grade', 'absent'),
    ('Anika Palla', '4th Grade', 'absent'),
    ('Dharnitha Sai Pasala', '4th Grade', 'absent'),
    ('Grihitha Gangadhari', '4th Grade', 'present'),
    ('Krrishaa Parished', '4th Grade', 'absent'),
    ('Lasya Sree Vegunta', '4th Grade', 'absent'),
    ('Nikshith Visam', '4th Grade', 'absent'),
    ('Shivay Dwivedi', '4th Grade', 'absent'),
    ('Sreenitha Mateti', '4th Grade', 'absent'),
    ('Aadhya Datar', '5th Grade', 'present'),
    ('Aarush Reddy Dasari', '5th Grade', 'present'),
    ('Deeksha Reddy Palli', '5th Grade', 'present'),
    ('Jash Keyur Patel', '5th Grade', 'absent'),
    ('Megha S Obulasetty', '5th Grade', 'present'),
    ('Riya Jindal', '5th Grade', 'absent'),
    ('Sai Manvitha Manikyala', '5th Grade', 'absent'),
    ('Sreevalli Dasam', '5th Grade', 'present'),
    ('Vedansh Kothapalli', '5th Grade', 'absent'),
    ('Yuvan Sairam Gaddipati', '5th Grade', 'absent'),
    ('Joshnika Sathi', '6th Grade', 'absent'),
    ('Navya Perambuduru', '6th Grade', 'present'),
    ('Purvy Gadker', '6th Grade', 'present'),
    ('Sanvitha Sree', '6th Grade', 'absent'),
    ('Srinidhi Karumuri', '6th Grade', 'absent'),
    ('Tejaswi Kavuri', '6th Grade', 'present'),
    ('Vasavi Avantika Solasa', '6th Grade', 'absent'),
    ('Yuktha Boppana', '6th Grade', 'absent'),
    ('Anjini Gupta', '7th Grade', 'absent'),
    ('Avignya Maram', '7th Grade', 'absent'),
    ('Harshan Chava', '7th Grade', 'absent'),
    ('Nandhakishore Rahul Nair', '7th Grade', 'absent'),
    ('Prakhar Thakur', '7th Grade', 'present'),
    ('Yashvi Keyur Patel', '7th Grade', 'absent'),
    ('Aadyashakti Joshi', '8th Grade', 'absent'),
    ('Aaradhya Palavarapu', '8th Grade', 'absent'),
    ('Akshaj Dwivedi', '8th Grade', 'absent'),
    ('Akshaj Prathi', '8th Grade', 'absent'),
    ('Anushree Solanki', '8th Grade', 'present'),
    ('Ashish Reddy Yellampalli', '8th Grade', 'absent'),
    ('Nimith Kasireddy', '8th Grade', 'absent'),
    ('Praneeth Sistla', '8th Grade', 'absent'),
    ('Sagashra Sridhar Kumuthapriya', '8th Grade', 'absent'),
    ('Sahasra Maram', '8th Grade', 'present'),
    ('Aadhya Boppana', '9th Grade', 'absent'),
    ('Dhanasri Kavuri', '9th Grade', 'present'),
    ('Pujya Jillella', '9th Grade', 'present'),
    ('Ridhima Kothapalli', '9th Grade', 'absent'),
    ('Rishika Poorvi Gangadhari', '9th Grade', 'present'),
    ('Samhith Komaragiri', '9th Grade', 'absent'),
    ('Sanhitha Perambuduru', '9th Grade', 'present'),
    ('Shruti Gummididala', '9th Grade', 'present'),
    ('Sudhishna Sathi', '9th Grade', 'absent'),
    ('Sujeev Rayagada', '9th Grade', 'present'),
    ('Venkata Manpreeth Bolisetty', '9th Grade', 'absent'),
    ('Harshan Krishnamoorthy', '10th Grade', 'absent'),
    ('Jayashakthiganesh Jayapradhaban Kala', '10th Grade', 'absent'),
    ('Nekshita Obulasetty', '10th Grade', 'absent'),
    ('Nidhisri Korrapati', '10th Grade', 'present'),
    ('Pranavi Sidella', '10th Grade', 'absent'),
    ('Rahul K Jindal', '10th Grade', 'absent'),
    ('Sai Saanvi Katarla', '10th Grade', 'absent'),
    ('Srijani Samala', '10th Grade', 'absent'),
    ('Tanvi Bandi', '10th Grade', 'absent'),
    ('Yuvraj Singh Tanwar', '10th Grade', 'present'),
    ('Divish Sai Dhanalakota', '11th Grade', 'absent'),
    ('Kushagra', '11th Grade', 'present'),
    ('Parth Chourasia', '11th Grade', 'present'),
    ('Priyasmruthi Visam', '11th Grade', 'absent'),
    ('Devika Eluru', '12th Grade', 'absent'),
    ('Hrushikesh Eluru', '12th Grade', 'absent'),
    ('Uma Narayanan', '12th Grade', 'absent'),
    ('Sudheeksha Vennu', '4th Grade', 'present'),
    ('Deetya Sri Kadiyala', '5th Grade', 'present'),
    ('Vihaan Vennu', '8th Grade', 'present')
  ) as p(full_name, grade_level, status)
where not exists (
  select 1 from students s where trim(lower(s.full_name)) = trim(lower(p.full_name))
);

-- ===== STEP 3: names that match MORE THAN ONE student (must be empty) =====
-- STEP 4 already excludes these automatically -- this is just so you know
-- which student(s) got skipped and need manual entry instead.
select p.full_name, count(*) as match_count
from
(
  values
    ('Aarya Datar', '3rd Grade', 'present'),
    ('Ananya Sai Moddu', '3rd Grade', 'present'),
    ('Jatin Nunna', '3rd Grade', 'absent'),
    ('Lakshmi Mahanya Pokuru', '3rd Grade', 'absent'),
    ('Misheeta Reddy Palli', '3rd Grade', 'present'),
    ('Rohita Prathi', '3rd Grade', 'absent'),
    ('Anika Palla', '4th Grade', 'absent'),
    ('Dharnitha Sai Pasala', '4th Grade', 'absent'),
    ('Grihitha Gangadhari', '4th Grade', 'present'),
    ('Krrishaa Parished', '4th Grade', 'absent'),
    ('Lasya Sree Vegunta', '4th Grade', 'absent'),
    ('Nikshith Visam', '4th Grade', 'absent'),
    ('Shivay Dwivedi', '4th Grade', 'absent'),
    ('Sreenitha Mateti', '4th Grade', 'absent'),
    ('Aadhya Datar', '5th Grade', 'present'),
    ('Aarush Reddy Dasari', '5th Grade', 'present'),
    ('Deeksha Reddy Palli', '5th Grade', 'present'),
    ('Jash Keyur Patel', '5th Grade', 'absent'),
    ('Megha S Obulasetty', '5th Grade', 'present'),
    ('Riya Jindal', '5th Grade', 'absent'),
    ('Sai Manvitha Manikyala', '5th Grade', 'absent'),
    ('Sreevalli Dasam', '5th Grade', 'present'),
    ('Vedansh Kothapalli', '5th Grade', 'absent'),
    ('Yuvan Sairam Gaddipati', '5th Grade', 'absent'),
    ('Joshnika Sathi', '6th Grade', 'absent'),
    ('Navya Perambuduru', '6th Grade', 'present'),
    ('Purvy Gadker', '6th Grade', 'present'),
    ('Sanvitha Sree', '6th Grade', 'absent'),
    ('Srinidhi Karumuri', '6th Grade', 'absent'),
    ('Tejaswi Kavuri', '6th Grade', 'present'),
    ('Vasavi Avantika Solasa', '6th Grade', 'absent'),
    ('Yuktha Boppana', '6th Grade', 'absent'),
    ('Anjini Gupta', '7th Grade', 'absent'),
    ('Avignya Maram', '7th Grade', 'absent'),
    ('Harshan Chava', '7th Grade', 'absent'),
    ('Nandhakishore Rahul Nair', '7th Grade', 'absent'),
    ('Prakhar Thakur', '7th Grade', 'present'),
    ('Yashvi Keyur Patel', '7th Grade', 'absent'),
    ('Aadyashakti Joshi', '8th Grade', 'absent'),
    ('Aaradhya Palavarapu', '8th Grade', 'absent'),
    ('Akshaj Dwivedi', '8th Grade', 'absent'),
    ('Akshaj Prathi', '8th Grade', 'absent'),
    ('Anushree Solanki', '8th Grade', 'present'),
    ('Ashish Reddy Yellampalli', '8th Grade', 'absent'),
    ('Nimith Kasireddy', '8th Grade', 'absent'),
    ('Praneeth Sistla', '8th Grade', 'absent'),
    ('Sagashra Sridhar Kumuthapriya', '8th Grade', 'absent'),
    ('Sahasra Maram', '8th Grade', 'present'),
    ('Aadhya Boppana', '9th Grade', 'absent'),
    ('Dhanasri Kavuri', '9th Grade', 'present'),
    ('Pujya Jillella', '9th Grade', 'present'),
    ('Ridhima Kothapalli', '9th Grade', 'absent'),
    ('Rishika Poorvi Gangadhari', '9th Grade', 'present'),
    ('Samhith Komaragiri', '9th Grade', 'absent'),
    ('Sanhitha Perambuduru', '9th Grade', 'present'),
    ('Shruti Gummididala', '9th Grade', 'present'),
    ('Sudhishna Sathi', '9th Grade', 'absent'),
    ('Sujeev Rayagada', '9th Grade', 'present'),
    ('Venkata Manpreeth Bolisetty', '9th Grade', 'absent'),
    ('Harshan Krishnamoorthy', '10th Grade', 'absent'),
    ('Jayashakthiganesh Jayapradhaban Kala', '10th Grade', 'absent'),
    ('Nekshita Obulasetty', '10th Grade', 'absent'),
    ('Nidhisri Korrapati', '10th Grade', 'present'),
    ('Pranavi Sidella', '10th Grade', 'absent'),
    ('Rahul K Jindal', '10th Grade', 'absent'),
    ('Sai Saanvi Katarla', '10th Grade', 'absent'),
    ('Srijani Samala', '10th Grade', 'absent'),
    ('Tanvi Bandi', '10th Grade', 'absent'),
    ('Yuvraj Singh Tanwar', '10th Grade', 'present'),
    ('Divish Sai Dhanalakota', '11th Grade', 'absent'),
    ('Kushagra', '11th Grade', 'present'),
    ('Parth Chourasia', '11th Grade', 'present'),
    ('Priyasmruthi Visam', '11th Grade', 'absent'),
    ('Devika Eluru', '12th Grade', 'absent'),
    ('Hrushikesh Eluru', '12th Grade', 'absent'),
    ('Uma Narayanan', '12th Grade', 'absent'),
    ('Sudheeksha Vennu', '4th Grade', 'present'),
    ('Deetya Sri Kadiyala', '5th Grade', 'present'),
    ('Vihaan Vennu', '8th Grade', 'present')
  ) as p(full_name, grade_level, status)
join students s on trim(lower(s.full_name)) = trim(lower(p.full_name))
group by p.full_name
having count(*) > 1;

-- ===== STEP 4: the actual insert =====
-- Skips any paper name matching zero or more-than-one student (STEP 2/3),
-- and skips any (student, class, date) that already has a row, so this is
-- safe to re-run after fixing a name mismatch.
insert into attendance (student_id, class_id, date, status, marked_by)
select
  s.id,
  (select id from classes where name = 'Gita'),
  date '2026-09-12',
  p.status,
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from
(
  values
    ('Aarya Datar', '3rd Grade', 'present'),
    ('Ananya Sai Moddu', '3rd Grade', 'present'),
    ('Jatin Nunna', '3rd Grade', 'absent'),
    ('Lakshmi Mahanya Pokuru', '3rd Grade', 'absent'),
    ('Misheeta Reddy Palli', '3rd Grade', 'present'),
    ('Rohita Prathi', '3rd Grade', 'absent'),
    ('Anika Palla', '4th Grade', 'absent'),
    ('Dharnitha Sai Pasala', '4th Grade', 'absent'),
    ('Grihitha Gangadhari', '4th Grade', 'present'),
    ('Krrishaa Parished', '4th Grade', 'absent'),
    ('Lasya Sree Vegunta', '4th Grade', 'absent'),
    ('Nikshith Visam', '4th Grade', 'absent'),
    ('Shivay Dwivedi', '4th Grade', 'absent'),
    ('Sreenitha Mateti', '4th Grade', 'absent'),
    ('Aadhya Datar', '5th Grade', 'present'),
    ('Aarush Reddy Dasari', '5th Grade', 'present'),
    ('Deeksha Reddy Palli', '5th Grade', 'present'),
    ('Jash Keyur Patel', '5th Grade', 'absent'),
    ('Megha S Obulasetty', '5th Grade', 'present'),
    ('Riya Jindal', '5th Grade', 'absent'),
    ('Sai Manvitha Manikyala', '5th Grade', 'absent'),
    ('Sreevalli Dasam', '5th Grade', 'present'),
    ('Vedansh Kothapalli', '5th Grade', 'absent'),
    ('Yuvan Sairam Gaddipati', '5th Grade', 'absent'),
    ('Joshnika Sathi', '6th Grade', 'absent'),
    ('Navya Perambuduru', '6th Grade', 'present'),
    ('Purvy Gadker', '6th Grade', 'present'),
    ('Sanvitha Sree', '6th Grade', 'absent'),
    ('Srinidhi Karumuri', '6th Grade', 'absent'),
    ('Tejaswi Kavuri', '6th Grade', 'present'),
    ('Vasavi Avantika Solasa', '6th Grade', 'absent'),
    ('Yuktha Boppana', '6th Grade', 'absent'),
    ('Anjini Gupta', '7th Grade', 'absent'),
    ('Avignya Maram', '7th Grade', 'absent'),
    ('Harshan Chava', '7th Grade', 'absent'),
    ('Nandhakishore Rahul Nair', '7th Grade', 'absent'),
    ('Prakhar Thakur', '7th Grade', 'present'),
    ('Yashvi Keyur Patel', '7th Grade', 'absent'),
    ('Aadyashakti Joshi', '8th Grade', 'absent'),
    ('Aaradhya Palavarapu', '8th Grade', 'absent'),
    ('Akshaj Dwivedi', '8th Grade', 'absent'),
    ('Akshaj Prathi', '8th Grade', 'absent'),
    ('Anushree Solanki', '8th Grade', 'present'),
    ('Ashish Reddy Yellampalli', '8th Grade', 'absent'),
    ('Nimith Kasireddy', '8th Grade', 'absent'),
    ('Praneeth Sistla', '8th Grade', 'absent'),
    ('Sagashra Sridhar Kumuthapriya', '8th Grade', 'absent'),
    ('Sahasra Maram', '8th Grade', 'present'),
    ('Aadhya Boppana', '9th Grade', 'absent'),
    ('Dhanasri Kavuri', '9th Grade', 'present'),
    ('Pujya Jillella', '9th Grade', 'present'),
    ('Ridhima Kothapalli', '9th Grade', 'absent'),
    ('Rishika Poorvi Gangadhari', '9th Grade', 'present'),
    ('Samhith Komaragiri', '9th Grade', 'absent'),
    ('Sanhitha Perambuduru', '9th Grade', 'present'),
    ('Shruti Gummididala', '9th Grade', 'present'),
    ('Sudhishna Sathi', '9th Grade', 'absent'),
    ('Sujeev Rayagada', '9th Grade', 'present'),
    ('Venkata Manpreeth Bolisetty', '9th Grade', 'absent'),
    ('Harshan Krishnamoorthy', '10th Grade', 'absent'),
    ('Jayashakthiganesh Jayapradhaban Kala', '10th Grade', 'absent'),
    ('Nekshita Obulasetty', '10th Grade', 'absent'),
    ('Nidhisri Korrapati', '10th Grade', 'present'),
    ('Pranavi Sidella', '10th Grade', 'absent'),
    ('Rahul K Jindal', '10th Grade', 'absent'),
    ('Sai Saanvi Katarla', '10th Grade', 'absent'),
    ('Srijani Samala', '10th Grade', 'absent'),
    ('Tanvi Bandi', '10th Grade', 'absent'),
    ('Yuvraj Singh Tanwar', '10th Grade', 'present'),
    ('Divish Sai Dhanalakota', '11th Grade', 'absent'),
    ('Kushagra', '11th Grade', 'present'),
    ('Parth Chourasia', '11th Grade', 'present'),
    ('Priyasmruthi Visam', '11th Grade', 'absent'),
    ('Devika Eluru', '12th Grade', 'absent'),
    ('Hrushikesh Eluru', '12th Grade', 'absent'),
    ('Uma Narayanan', '12th Grade', 'absent'),
    ('Sudheeksha Vennu', '4th Grade', 'present'),
    ('Deetya Sri Kadiyala', '5th Grade', 'present'),
    ('Vihaan Vennu', '8th Grade', 'present')
  ) as p(full_name, grade_level, status)
join students s on trim(lower(s.full_name)) = trim(lower(p.full_name))
where (
  select count(*) from students s2 where trim(lower(s2.full_name)) = trim(lower(p.full_name))
) = 1
and not exists (
  select 1 from attendance a
  where a.student_id = s.id
    and a.class_id = (select id from classes where name = 'Gita')
    and a.date = date '2026-09-12'
);

-- ===== STEP 5: confirm =====
select count(*) as rows_inserted, status
from attendance
where class_id = (select id from classes where name = 'Gita')
  and date = date '2026-09-12'
group by status
order by status;
