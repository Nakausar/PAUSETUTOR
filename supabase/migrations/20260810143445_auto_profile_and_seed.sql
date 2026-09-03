/*
# Auto-profile trigger + sample task seed

1. Alter `tasks.created_by` to be nullable so seed data can be inserted without
   an auth session (it already has ON DELETE SET NULL).
2. New Function: `handle_new_user()` — inserts a `profiles` row whenever a new
   auth.users row is created, so every new account gets a pseudonymous
   participant_id automatically.
3. New Trigger: `on_auth_user_created` — fires after INSERT on auth.users.
4. Seed data: two sample Python programming tasks.
*/

ALTER TABLE tasks ALTER COLUMN created_by DROP NOT NULL;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'role', 'student'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

INSERT INTO tasks (title, language, difficulty, learning_objectives, problem_description, expected_inputs, expected_outputs, starter_code, test_cases, concept_tags)
VALUES (
  'FizzBuzz',
  'python',
  'beginner',
  'Understand loops and conditional logic; practise string output formatting.',
  'Write a program that prints the numbers from 1 to 100. But for multiples of three print "Fizz" instead of the number and for the multiples of five print "Buzz". For numbers which are multiples of both three and five print "FizzBuzz".',
  'No input required.',
  'Numbers 1 to 100, one per line, with multiples of 3 replaced by Fizz, multiples of 5 replaced by Buzz, and multiples of both replaced by FizzBuzz.',
  '# Write your solution here\n',
  '[{"input":"","expected":"1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz"}]',
  'loops, conditionals, modulo, strings'
)
ON CONFLICT DO NOTHING;

INSERT INTO tasks (title, language, difficulty, learning_objectives, problem_description, expected_inputs, expected_outputs, starter_code, test_cases, concept_tags)
VALUES (
  'Palindrome Checker',
  'python',
  'beginner',
  'Practise string manipulation and boolean logic.',
  'Write a function called is_palindrome that takes a string and returns True if it reads the same forwards and backwards, ignoring spaces, punctuation, and case. Otherwise return False.',
  'A single string, e.g. "A man a plan a canal Panama"',
  'True or False',
  'def is_palindrome(s):\n    # Your code here\n    pass\n',
  '[{"input":"racecar","expected":"True"},{"input":"hello","expected":"False"},{"input":"A man a plan a canal Panama","expected":"True"}]',
  'functions, strings, boolean, comparison'
)
ON CONFLICT DO NOTHING;