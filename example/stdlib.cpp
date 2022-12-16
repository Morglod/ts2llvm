#include <algorithm>
#include <cstdio>
#include <stdio.h>
#include <memory>
#include <vector>

extern "C" {

void print_string(void* _, const char* str) {
    puts(str);
}

double stdlib_sum(void* _, double a, double b) {
    return a + b;
}

void stdlib_log_number(void* _, double a) {
    printf("%f\n", a);
}

void entry();

int main(int _1, char** _2) {
    entry();
    return 0;
}

}

// -------- scheduler  --------

class SchedulerTask {
public:
    uint64_t after_time = 0;
    bool done = false;
    virtual void exec() {}
};

std::vector<SchedulerTask*> scheduler_queue;

// this function is run to process async tasks queue
extern "C"
void scheduler_step() {
    const uint64_t current_time = 0;

    std::for_each(scheduler_queue.begin(), scheduler_queue.end(), [current_time](SchedulerTask* task) {
        if (task->after_time <= current_time) {
            task->exec();
            task->done = true;
        }
    });

    // TODO: update scheduler_queue iterator
    scheduler_queue.erase(std::remove_if(scheduler_queue.begin(), scheduler_queue.end(), [](SchedulerTask* task) {
        return task->done;
    }), scheduler_queue.end());
}

// -------- GC --------

struct ObjectBase {
    alignas(4) int32_t refCounter;
    alignas(4) int32_t typeId;
};

std::vector<ObjectBase*> gc_queue;

extern "C"
void gc_mark_release(int8_t* obj_) {
    ObjectBase* obj = (ObjectBase*)obj_;
    gc_queue.emplace_back(obj);

    printf("gc_mark_release called %p %i\n", obj, obj->refCounter);
}

void gc_destroy(ObjectBase* obj) {
    // TODO: call type 'destructor' here?
    // TODO: decrease all ref counters of obj FIELDS near this call
    free(obj);
}

extern "C"
void gc_step() {
    std::for_each(gc_queue.begin(), gc_queue.end(), [](ObjectBase* obj) {
        gc_destroy(obj);
    });
    scheduler_queue.clear();
}
