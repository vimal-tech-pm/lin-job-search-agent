# Himalaya SMTP Configuration for Gmail

To enable email sending via himalaya CLI, add SMTP backend to `~/.config/himalaya/config.toml`.

## Minimal SMTP block for Gmail

```toml
# SMTP for sending
message.send.backend.type = "smtp"
message.send.backend.host = "smtp.gmail.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "you@example.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "secret-tool lookup service himalaya account you@example.com"
```

## Verification

```bash
HOME=~ himalaya account list
# Should show: IMAP, SMTP
```

## Sending email with attachment (MML syntax)

```bash
HOME=~ himalaya template send <<'MML'
From: you@example.com
To: recipient@example.com
Subject: Subject line

<#multipart type=mixed>
<#part type=text/plain>
Email body here.
<#part filename=/absolute/path/to/file.pdf name=DisplayName.pdf><#/part>
<#/multipart>
MML
```

## CRITICAL: Never send without confirmation

The user's hard rule: NEVER send emails without explicit confirmation. Always save the draft to a file first and ask the user to confirm before sending. See lin skill §pitfalls.
