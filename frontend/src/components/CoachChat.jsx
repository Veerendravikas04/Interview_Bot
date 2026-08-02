import React, { useState, useEffect, useRef } from 'react';
import { Send, User, Bot, Mic, MicOff, Download, Sparkles, FileText, Activity } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'framer-motion';
import jsPDF from 'jspdf';
import { WS_THREADS } from '@/lib/config';

const sanitizeContent = (text) => {
  if (!text) return text;
  let sanitized = text;
  // Strip out (function=...) or <function=...> blocks
  sanitized = sanitized.replace(/[<(]?function=[^>]*>[\s\S]*?(?:<\/function>|\})/gi, '');
  // Strip out naked Record_round_grade={...} leakage
  sanitized = sanitized.replace(/(?:record_round_grade|record_hint_given)\s*=?\s*\{[\s\S]*?(?:\}|$)/gi, '');
  // Strip out any residual JSON payload
  sanitized = sanitized.replace(/\{[^{}]*"round_num"[^{}]*\}/g, '');
  return sanitized.trim();
};

// generateScore has been removed.

const InteractiveMessage = ({ content, onApply }) => {
  const parts = content.split(/(\[SUGGEST\][\s\S]*?\[\/SUGGEST\])/g);
  
  return (
    <div style={{ lineHeight: '1.6' }}>
      {parts.map((part, i) => {
        if (part.startsWith('[SUGGEST]') && part.endsWith('[/SUGGEST]')) {
          const suggestedText = part.slice(9, -10);
          return (
            <div key={i} style={{ display: 'inline' }}>
              <span style={{ fontWeight: 'bold', color: '#93c5fd' }}>"{suggestedText}"</span>
              <div style={{ display: 'flex', gap: '0.8rem', marginTop: '1rem', marginBottom: '0.5rem' }}>
                <button 
                  onClick={() => onApply(suggestedText)}
                  style={{
                    background: '#bfdbfe',
                    color: '#1e3a8a',
                    border: 'none',
                    padding: '0.4rem 1rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = '#93c5fd'}
                  onMouseOut={(e) => e.currentTarget.style.background = '#bfdbfe'}
                >
                  Apply to Resume
                </button>
                <button 
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    color: '#cbd5e1',
                    border: 'none',
                    padding: '0.4rem 1rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                >
                  Discuss More
                </button>
              </div>
            </div>
          );
        }
        return <ReactMarkdown key={i} components={{ p: ({node, ...props}) => <span {...props} /> }}>{part}</ReactMarkdown>;
      })}
    </div>
  );
};

const CoachChat = ({ threadId, token, onProceed, resumeText, setResumeText, extractedSkills = [] }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [statusText, setStatusText] = useState('Initializing Coach Session...');
  const messagesEndRef = useRef(null);
  const ws = useRef(null);

  // Take top 2 skills for the mockup
  const displaySkills = extractedSkills.slice(0, 2);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, statusText]);

  useEffect(() => {
    const wsUrl = `${WS_THREADS}/${threadId}?token=${token}`;
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      setIsLoading(true);
      setStatusText('Connection established. Waking up Tech Lead...');
      ws.current.send(JSON.stringify({ action: "answer", text: "Hello! Please review my resume." }));
    };

    ws.current.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      const eventType = payload.event_type;
      const data = payload.data || {};
      
      if (eventType === 'token') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'bot' && last.isStreaming) {
            let newContent = last.content + data.delta;
            newContent = newContent.replace(/[<(]?function=[^>]*>[\s\S]*?(?:<\/function>|\}|$)/g, '');
            return [...prev.slice(0, -1), { role: 'bot', content: newContent, isStreaming: true }];
          } else {
            let newContent = data.delta;
            newContent = newContent.replace(/[<(]?function=[^>]*>[\s\S]*?(?:<\/function>|\}|$)/g, '');
            return [...prev, { role: 'bot', content: newContent, isStreaming: true }];
          }
        });
      } 
      else if (eventType === 'message_complete') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'bot') {
            return [...prev.slice(0, -1), { role: 'bot', content: data.content }];
          } else {
            return [...prev, { role: 'bot', content: data.content }];
          }
        });
        setIsLoading(false);
        setStatusText('');
      } 
      else if (eventType === 'status') {
        setStatusText(data.message);
      } 
      else if (eventType === 'error') {
        setMessages(prev => [...prev, { role: 'bot', content: `⚠️ **Error:** ${data.message}` }]);
        setIsLoading(false);
        setStatusText('');
      }
    };

    ws.current.onclose = () => {
      console.log('WebSocket disconnected');
    };

    return () => {
      if (ws.current) ws.current.close();
    };
  }, [threadId, token]);

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Your browser does not support Voice Input. Try Chrome or Edge.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => prev + (prev ? " " : "") + transcript);
      setIsRecording(false);
    };
    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      setIsRecording(false);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.start();
  };

  const handleSubmission = (textPayload) => {
    let submission = textPayload.trim();
    if (submission && !isLoading && ws.current && ws.current.readyState === WebSocket.OPEN) {
      setMessages(prev => [...prev, { role: 'user', content: submission }]);
      setIsLoading(true);
      setStatusText('Processing your response...');
      ws.current.send(JSON.stringify({ action: "answer", text: submission }));
      setInput('');
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    handleSubmission(input);
  };

  const handleApplyToResume = (suggestedText) => {
    const newResume = `• ${suggestedText}\n\n` + resumeText;
    setResumeText(newResume);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(resumeText, 180);
    doc.setFontSize(16);
    doc.text("Optimized Resume", 15, 20);
    doc.setFontSize(11);
    doc.text(lines, 15, 30);
    doc.save("Optimized_Resume.pdf");
  };

  return (
    <div style={{ display: 'flex', gap: '2rem', maxWidth: '1400px', margin: '0 auto', height: '100%', paddingRight: '1rem' }}>
      
      {/* CENTER CHAT COLUMN */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%',
        flex: 1,
        position: 'relative'
      }}>
        {/* Header Bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#f8fafc', margin: 0 }}>Resume Coach</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: 0 }}>AI-driven optimizations for your professional narrative.</p>
        </div>

        {/* Message Thread */}
        <div style={{ 
          flex: 1, 
          overflowY: 'auto', 
          padding: '2rem 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          scrollbarWidth: 'none', // Firefox
          msOverflowStyle: 'none',  // IE and Edge
        }}>
          {messages.map((msg, index) => (
            <motion.div 
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                display: 'flex',
                gap: '1rem',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row'
              }}
            >
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: msg.role === 'user' ? '#0284c7' : '#e0e7ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '0.5rem'
              }}>
                {msg.role === 'user' ? <User size={16} color="white" /> : <Bot size={16} color="#4338ca" />}
              </div>
              <div style={{
                background: msg.role === 'user' ? 'rgba(2, 132, 199, 0.2)' : '#1e293b',
                padding: '1.2rem',
                borderRadius: '12px',
                maxWidth: '85%',
                color: '#e2e8f0',
                lineHeight: '1.6',
                border: msg.role === 'bot' ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(2, 132, 199, 0.3)'
              }}>
                {msg.role === 'bot' ? (
                  <InteractiveMessage content={sanitizeContent(msg.content)} onApply={handleApplyToResume} />
                ) : (
                  <ReactMarkdown>{sanitizeContent(msg.content)}</ReactMarkdown>
                )}
              </div>
            </motion.div>
          ))}
          
          {isLoading && statusText && (
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '0.5rem' }}>
                <Bot size={16} color="#4338ca" />
              </div>
              <div style={{ background: '#1e293b', padding: '1.2rem', borderRadius: '12px', color: '#94a3b8' }}>
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                >
                  {statusText}
                </motion.div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Form */}
        <form onSubmit={handleSend} style={{ 
          display: 'flex',
          gap: '1rem',
          background: '#0f172a',
          padding: '0.8rem 1rem',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.1)',
          alignItems: 'center'
        }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRecording ? "Listening..." : "Ask about your resume..."}
            disabled={isLoading}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: '#f8fafc',
              fontSize: '0.95rem',
              outline: 'none'
            }}
          />
          <button
            type="button"
            onClick={toggleRecording}
            disabled={isLoading}
            style={{
              background: 'transparent',
              border: 'none',
              color: isRecording ? '#ef4444' : '#64748b',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button 
            type="submit"
            disabled={isLoading || !input.trim()}
            style={{
              background: 'transparent',
              border: 'none',
              color: (isLoading || !input.trim()) ? '#334155' : '#60a5fa',
              cursor: (isLoading) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <Send size={18} />
          </button>
        </form>
      </div>

      {/* RIGHT PANEL COLUMN */}
      <div style={{ 
        width: '380px', 
        display: 'flex', 
        flexDirection: 'column',
        gap: '1.5rem',
        height: '100%'
      }}>
        {/* Top Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', alignItems: 'center' }}>
          <button 
            onClick={handleExportPDF}
            style={{
              background: 'rgba(255,255,255,0.1)',
              color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.1)',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          >
            <Download size={14} /> Export PDF
          </button>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: '#bfdbfe',
            color: '#1e3a8a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: '0.9rem'
          }}>
            JD
          </div>
        </div>

        {/* Collapsible Analytics & Data */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
          
          {/* Skill Impact Scores */}
          {displaySkills.length > 0 && (
            <details style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem' }}>
              <summary style={{ fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Activity size={16} /> Skill Impact Scores
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                {displaySkills.map((skillObj, i) => {
                  const skillName = typeof skillObj === 'string' ? skillObj : skillObj.skill;
                  const score = typeof skillObj === 'object' && skillObj.confidence ? Math.round(skillObj.confidence * 100) : "N/A";
                  return (
                    <div key={i} className="glass-panel" style={{ padding: '1.2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Activity size={18} color="#60a5fa" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '600', color: '#f8fafc', fontSize: '0.95rem' }}>{skillName}</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Technical Depth</div>
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f8fafc', borderBottom: '2px solid #f8fafc', paddingBottom: '0.2rem' }}>
                        {score}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* Extracted Text Live Sync */}
          <details style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
            <summary style={{ fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <FileText size={16} /> Extracted Text Sync
            </summary>
            <div className="glass-panel" style={{ 
              marginTop: '1.5rem',
              padding: '1.2rem', 
              fontSize: '0.85rem', 
              color: '#cbd5e1', 
              lineHeight: '1.7',
              whiteSpace: 'pre-wrap',
              maxHeight: '300px',
              overflowY: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.1) transparent'
            }}>
               {resumeText || "No text extracted."}
            </div>
          </details>

        </div>

        {/* Bottom Actions */}
        <button 
          onClick={onProceed}
          style={{
            background: '#bfdbfe',
            color: '#1e3a8a',
            border: 'none',
            padding: '1rem',
            borderRadius: '12px',
            fontWeight: 'bold',
            fontSize: '0.95rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            transition: 'background 0.2s',
            marginTop: 'auto'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#93c5fd'}
          onMouseOut={(e) => e.currentTarget.style.background = '#bfdbfe'}
        >
          <Activity size={16} /> Start Interview
        </button>

      </div>
    </div>
  );
};

export default CoachChat;
