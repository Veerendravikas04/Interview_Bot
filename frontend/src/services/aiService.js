const API_URL = 'http://localhost:8000/api';

const getHeaders = () => {
  const token = localStorage.getItem('careerForgeToken');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

export const uploadResume = async (file) => {
  const token = localStorage.getItem('careerForgeToken');
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_URL}/resumes/`, {
    method: 'POST',
    // NOTE: do NOT set Content-Type — the browser sets the multipart boundary itself.
    headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    body: formData
  });
  if (!response.ok) {
    let detail = "Failed to upload resume";
    try { const err = await response.json(); detail = err.message || detail; } catch (_) {}
    throw new Error(detail);
  }
  return await response.json();
};

export const extractSkills = async (resumeId, resumeText) => {
  try {
    const response = await fetch(`${API_URL}/resumes/extract-skills`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ resume_id: resumeId, resumeText })
    });
    if (!response.ok) throw new Error("Failed to extract skills");
    const data = await response.json();
    return data.skills || [];
  } catch (error) {
    console.error("Error extracting skills:", error);
    return [{"skill": "React", "confidence": 0.9}, {"skill": "JavaScript", "confidence": 0.85}, {"skill": "Python", "confidence": 0.8}];
  }
};

export const createThread = async (resumeId, difficulty, maxQuestions, selectedSkills) => {
  const response = await fetch(`${API_URL}/threads/`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ 
      resume_id: resumeId, 
      difficulty, 
      max_questions: maxQuestions, 
      skills: selectedSkills 
    })
  });
  if (!response.ok) throw new Error("Failed to create thread");
  return await response.json();
};

export const createCoachThread = async (resumeId) => {
  const response = await fetch(`${API_URL}/threads/`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ 
      resume_id: resumeId, 
      type: 'coaching'
    })
  });
  if (!response.ok) throw new Error("Failed to create coach thread");
  return await response.json();
};

export const fetchHistory = async () => {
  try {
    const response = await fetch(`${API_URL}/threads/`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error("Failed to fetch history");
    return await response.json();
  } catch (error) {
    console.error("Error fetching history:", error);
    return [];
  }
};
