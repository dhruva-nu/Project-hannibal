from app.agent.tools.course_tools import recommend_course
from app.agent.tools.user_tools import get_user_profile

# Tools executed by the generic ToolNode (the LLM picks the args).
all_tools = [get_user_profile]

# Tools the LLM may call but that a dedicated node executes (the node, not the
# LLM, supplies some arguments — e.g. the difficulty level for recommendations).
recommend_tools = [recommend_course]
