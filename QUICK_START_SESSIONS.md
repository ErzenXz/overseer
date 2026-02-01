# Quick Start Guide: Session Management

## 🚀 Quick Overview

Your MyBot now has a **production-ready session management system** that:
- Tracks conversation context with token counting
- Automatically summarizes long conversations
- Caches hot sessions in memory for fast access
- Provides REST API for session management
- Integrates with Telegram and Discord bots

## ✅ What's Been Added

### New Files
1. `src/database/models/agent-sessions.ts` - Database model
2. `src/lib/session-manager.ts` - Core session logic
3. `src/app/api/sessions/route.ts` - REST API
4. `docs/SESSION_MANAGEMENT.md` - Full documentation
5. `SESSION_IMPLEMENTATION_SUMMARY.md` - Implementation details

### Modified Files
1. `src/bot/index.ts` - Telegram bot integration
2. `src/bot/discord.ts` - Discord bot integration

## 🎯 How It Works

### For Bot Users
**No changes needed!** The bots work exactly as before, but now:
- Long conversations are automatically managed
- Context is preserved across messages
- Token usage is tracked
- Performance is improved with caching

### For Developers

#### Get or Create a Session
```typescript
import { SessionManager } from './lib/session-manager';

const session = SessionManager.getOrCreateSession({
  conversation_id: 123,
  interface_type: "telegram", // or "discord", "web", etc.
  external_user_id: "user_123",
  external_chat_id: "chat_456",
});
```

#### Add Messages
```typescript
// User message
SessionManager.addMessage(session.id, "user", "Hello!");

// Assistant response  
SessionManager.addMessage(session.id, "assistant", "Hi there!");
```

#### Build Context for AI
```typescript
const context = SessionManager.buildContext(session.id, 20);
// Returns: { messages, totalTokens, hasSummaries }
// Use context.messages in your AI prompt
```

#### Track Events
```typescript
SessionManager.recordToolCall(session.id);
SessionManager.recordError(session.id);
```

#### Clear Session
```typescript
SessionManager.clearMessages(session.id);
```

## 📊 API Endpoints

### Get All Active Sessions
```bash
curl http://localhost:3000/api/sessions
```

### Get Session Stats
```bash
curl http://localhost:3000/api/sessions?stats=true
```

### Get Specific Session
```bash
curl http://localhost:3000/api/sessions?id=123
```

### Add Message
```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "action": "addMessage",
    "sessionId": 123,
    "data": {
      "role": "user",
      "content": "Hello world!"
    }
  }'
```

### Clear Messages
```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"action": "clearMessages", "sessionId": 123}'
```

## 🔧 Configuration

Edit `src/lib/session-manager.ts` to adjust:

```typescript
// Token limits
DEFAULT_TOKEN_LIMIT = 4000        // Context window size
SUMMARIZE_THRESHOLD = 0.7         // When to summarize (70%)

// Session lifecycle
SESSION_EXPIRY_MS = 86400000      // 24 hours
CLEANUP_INTERVAL_MS = 3600000     // Cleanup every 1 hour

// Performance
CACHE_MAX_SIZE = 1000             // Max sessions in memory
```

## 📈 Monitoring

### Check Statistics
```typescript
const stats = SessionManager.getStats();
console.log(stats);
// {
//   total_sessions: 100,
//   active_sessions: 25,
//   total_messages: 5432,
//   total_tokens: 123456,
//   average_session_length: 21.7,
//   sessions_by_interface: {...},
//   cacheSize: 25
// }
```

### Monitor Logs
Sessions are automatically logged with the "session-manager" category:
```bash
# Watch session activity
tail -f logs/mybot.log | grep session-manager
```

## 🧪 Testing

### Test Session Creation
```typescript
import { SessionManager } from './lib/session-manager';

// Create a test session
const session = SessionManager.getOrCreateSession({
  conversation_id: 999,
  interface_type: "test",
  external_user_id: "test_user",
  external_chat_id: "test_chat",
});

console.log('Session created:', session.id);

// Add some messages
for (let i = 0; i < 5; i++) {
  SessionManager.addMessage(session.id, "user", `Test message ${i}`);
  SessionManager.addMessage(session.id, "assistant", `Response ${i}`);
}

// Get the session
const updated = SessionManager.getSession(session.id);
console.log('Messages:', updated.message_count);
console.log('Tokens:', updated.total_tokens);
```

### Test Summarization
```typescript
// Add many messages to trigger summarization
for (let i = 0; i < 50; i++) {
  SessionManager.addMessage(
    session.id,
    "user",
    "This is a long message to test summarization. ".repeat(10)
  );
}

// Check if summary was created
const session = SessionManager.getSession(session.id);
console.log('Summaries:', session.summaries.length);
console.log('Messages remaining:', session.messages.length);
```

### Test Cleanup
```typescript
// Manually trigger cleanup
SessionManager.cleanup();
```

## 🎓 Learn More

- **Full Documentation**: `docs/SESSION_MANAGEMENT.md`
- **Implementation Details**: `SESSION_IMPLEMENTATION_SUMMARY.md`
- **Database Model**: `src/database/models/agent-sessions.ts`
- **Core Logic**: `src/lib/session-manager.ts`
- **API**: `src/app/api/sessions/route.ts`

## 🐛 Troubleshooting

### Sessions Not Persisting
1. Check database exists: `ls data/mybot.db`
2. Check permissions: `ls -la data/`
3. Review logs: `tail -f logs/mybot.log`

### High Memory Usage
- Reduce `CACHE_MAX_SIZE` in session-manager.ts
- Decrease `SESSION_EXPIRY_MS`
- Run cleanup more frequently

### Summaries Not Working
- Check `SUMMARIZE_THRESHOLD` (should be 0-1)
- Verify `MIN_MESSAGES_TO_SUMMARIZE` is reasonable
- Add logging in `checkAndSummarize()`

## 💡 Tips

1. **Monitor Cache Hit Rate**: Check logs for cache performance
2. **Adjust Token Limits**: Match your AI model's context window
3. **Use Statistics API**: Monitor usage patterns
4. **Clean Up Regularly**: Run cleanup during off-peak hours
5. **Test with Load**: Simulate many concurrent sessions

## 🎉 Success Indicators

You'll know it's working when:
- ✅ Bot responds to messages (Telegram/Discord)
- ✅ `/reset` command clears conversation
- ✅ Long conversations work smoothly
- ✅ API endpoints return data
- ✅ Statistics show active sessions
- ✅ Logs show session activity
- ✅ Database grows with conversations
- ✅ Memory usage stays reasonable

## 🚀 Next Steps

1. **Test the bots**: Send messages on Telegram/Discord
2. **Check API**: Query `/api/sessions?stats=true`
3. **Monitor logs**: Watch for session activity
4. **Adjust config**: Tune based on your usage
5. **Build features**: Use sessions in your own code

## 📞 Need Help?

- Check `docs/SESSION_MANAGEMENT.md` for detailed docs
- Review logs for errors
- Test API endpoints
- Verify database connectivity

---

**Status**: ✅ Production Ready
**Version**: 1.0.0
**Last Updated**: 2025

Enjoy your advanced session management! 🎊
