export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  is_admin: boolean;
};

export type Category = { id: number; name: string; icon: string; sort_order: number };
export type CategoryRef = { name: string; icon: string };

export type Mode = "solo" | "duel" | "challenge";

export type GameListItem = {
  id: number;
  mode: Mode;
  status: "open" | "finished" | "closed";
  created_at: string;
  finished_at: string | null;
  created_by: string;
  my_status: "pending" | "done";
  my_turn: boolean;
  can_nudge: boolean;
  category: CategoryRef | null;
  players: { user_id: string; display_name: string; status: "pending" | "done"; score: number | null; total_ms: number | null }[];
};

export type CurrentQuestion = {
  done: false;
  position: number;
  total: number;
  question_id: number;
  text: string;
  image_path: string | null;
  category: CategoryRef;
  author: string;
  substitute: boolean;
  options: string[];
  seconds_left: number;
  joker_available: boolean;
  hidden: number[];
};

export type AnswerResult = {
  position: number;
  chosen: number | null;
  correct_index: number;
  is_correct: boolean;
  timed_out: boolean;
  explanation: string | null;
  source_url: string | null;
  question_id: number;
  author: string;
  my_vote: number | null;
  finished: boolean;
};

export type PlayerAnswer = {
  chosen: number | null;
  is_correct: boolean | null;
  ms: number | null;
  joker: boolean;
  chosen_text: string | null;
};

export type GameDetails = {
  id: number;
  mode: Mode;
  status: "open" | "finished" | "closed";
  created_at: string;
  finished_at: string | null;
  created_by: string;
  category: CategoryRef | null;
  my_status: "pending" | "done";
  can_play: boolean;
  started: boolean;
  joker_used: boolean;
  can_nudge: boolean;
  can_close: boolean;
  my_points: { points: number; raw_points: number; counted: boolean; day_index: number | null } | null;
  players: {
    user_id: string;
    display_name: string;
    status: "pending" | "done";
    score: number | null;
    total_ms: number | null;
    rank: number | null;
  }[];
  questions: {
    position: number;
    question_id: number;
    substitute: boolean;
    text: string;
    image_path: string | null;
    category: CategoryRef;
    author: string;
    explanation: string | null;
    source_url: string | null;
    options: string[];
    correct_index: number;
    my_vote: number | null;
    answers: Record<string, PlayerAnswer>;
  }[];
};

export type Question = {
  id: number;
  category_id: number;
  author_id: string | null;
  text: string;
  image_path: string | null;
  correct: string;
  wrong_1: string;
  wrong_2: string;
  wrong_3: string;
  explanation: string | null;
  source_url: string | null;
  is_active: boolean;
  created_at: string;
};

export type QuestionStats = {
  question_id: number;
  plays: number;
  correct_rate: number | null;
  upvotes: number;
  downvotes: number;
  open_reports: number;
};

export type Fact = {
  id: number;
  author_id: string;
  text: string | null;
  image_path: string | null;
  created_at: string;
  author: { display_name: string } | null;
  fact_likes: { user_id: string }[];
};

export type DayStatus = { counted_games: number; points: number; limit_games: number; limit_points: number };

export type LeaderRow = {
  user_id: string;
  display_name: string;
  points: number;
  wins: number;
  games: number;
  correct_rate: number;
};
