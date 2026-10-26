CREATE TABLE IF NOT EXISTS user_sessions (
 id CHAR(36) PRIMARY KEY,
 user_id INT NOT NULL,
 expires_at DATETIME NOT NULL,
 last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_session_presence (last_seen_at, expires_at),
 FOREIGN KEY (user_id) REFERENCES users(userid) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_preferences (
 user_id INT PRIMARY KEY,
 availability ENUM('Online', 'Away') NOT NULL DEFAULT 'Online',
 FOREIGN KEY (user_id) REFERENCES users(userid) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS conversations (
 id INT AUTO_INCREMENT PRIMARY KEY,
 kind ENUM('direct', 'room') NOT NULL,
 name VARCHAR(255),
 direct_key VARCHAR(100) UNIQUE,
 created_by INT,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (created_by) REFERENCES users(userid) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS conversation_members (
 conversation_id INT NOT NULL,
 user_id INT NOT NULL,
 last_read_id INT NOT NULL DEFAULT 0,
 muted BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY (conversation_id, user_id),
 FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(userid) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS messages (
 id INT AUTO_INCREMENT PRIMARY KEY,
 conversation_id INT NOT NULL,
 user_id INT NOT NULL,
 body TEXT NOT NULL,
 attachment_name VARCHAR(255),
 attachment_mime VARCHAR(100),
 attachment_data MEDIUMBLOB,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_messages_conversation (conversation_id, id),
 FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(userid) ON DELETE CASCADE
);
-- A real shared entry channel, not mock conversation history or test data.
INSERT INTO conversations (kind,name,direct_key) VALUES ('room','General','room:general')
ON DUPLICATE KEY UPDATE direct_key=direct_key;
