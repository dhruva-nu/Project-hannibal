from app.agent.tools.course_tools import recommend_course
from app.agent.tools.user_tools import get_user_profile

# Tools executed by the generic ToolNode. ``recommend_course`` receives the
# active course_id via InjectedState, so the LLM only supplies the topic.
all_tools = [get_user_profile, recommend_course]
